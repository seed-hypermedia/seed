// Package server is the serve to monitor space status.
package server

import (
	"context"
	"encoding/csv"
	"fmt"
	"html/template"
	"net/http"
	"os"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"seed/backend/cmd/monitord/discord"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/host"
	"go.uber.org/zap"
)

// Srv is the server type.
type Srv struct {
	// MonitorStatus is a map where the key is the space hostname and the value the status.
	MonitorStatus *map[string]*spaceStatus
	discordClient *discord.BotClient
	mu            sync.Mutex
	node          host.Host
	numPings      int
	ticker        *time.Ticker
	chScan        chan bool
	log           *zap.Logger
	httpServer    *http.Server
	templateFile  string
	sitesCSV      string
}

type spaceStatus struct {
	StatusDNS              string
	LastDNSError           string
	LastCheck              string
	StatusP2P              string
	LastP2PError           string
	LastOKNotificationSent time.Time
	LastKONotificationSent time.Time
}

// NewServer returns a new monitor server. It also starts serving content on the provided port.
func NewServer(portHTTP, portP2P int, log *zap.Logger, sitesCSVPath, discordToken, discordChannelID string) (*Srv, error) {
	portStr := strconv.Itoa(portP2P)
	node, err := libp2p.New(
		libp2p.ListenAddrStrings([]string{
			"/ip4/0.0.0.0/tcp/" + portStr,
			"/ip4/0.0.0.0/udp/" + portStr + "/quic-v1"}...),
	)
	if err != nil {
		return nil, err
	}

	monitorStatus := make(map[string]*spaceStatus)
	srv := &Srv{
		MonitorStatus: &monitorStatus,
		node:          node,
		log:           log,
		sitesCSV:      sitesCSVPath,
	}
	if err := srv.updateSpaceList(); err != nil {
		return nil, err
	}

	srv.discordClient, err = discord.NewBot(log, discordToken, discordChannelID)
	if err != nil {
		log.Warn("Discord notifications disabled", zap.Error(err))
	}

	srv.httpServer = &http.Server{
		Addr:              "0.0.0.0:" + strconv.Itoa(portHTTP),
		ReadHeaderTimeout: 3 * time.Second,
		Handler:           srv,
	}

	return srv, nil
}

// Start starts the monitor.
func (s *Srv) Start(numPings int, scanPeriod time.Duration, peerTimeout time.Duration, templateFile string) {
	s.ticker = time.NewTicker(scanPeriod)
	s.numPings = numPings
	s.templateFile = templateFile
	go func() { _ = s.httpServer.ListenAndServe() }()

	go s.scan(peerTimeout)
}

// Stop closes the server and p2p node inside.
func (s *Srv) Stop() {
	s.ticker.Stop()
	s.chScan <- true
	_ = s.httpServer.Shutdown(context.Background())
	s.node.Close()
}

func (s *Srv) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.log.Debug("http Request", zap.String("template file", s.templateFile), zap.Any("data", s.MonitorStatus))
	tmpl, _ := template.ParseFiles(s.templateFile)
	err := tmpl.Execute(w, *s.MonitorStatus)
	if err != nil {
		s.log.Error("Error rendering page", zap.String("template file", s.templateFile), zap.Any("data", s.MonitorStatus), zap.Error(err))
	}
}

func (s *Srv) updateSpaceList() error {
	f, err := os.Open(s.sitesCSV)
	if err != nil {
		return fmt.Errorf("unable to read spaces file [%s]: %w", s.sitesCSV, err)
	}
	defer f.Close()
	csvReader := csv.NewReader(f)
	records, err := csvReader.ReadAll()
	if err != nil {
		return fmt.Errorf("unable to parse spaces reader as CSV for: %w", err)
	}

	newSpacesList := []string{}
	for idx, row := range records {
		if idx == 0 && strings.ToLower(strings.Replace(row[0], " ", "", -1)) != "hostname" {
			return fmt.Errorf("First row First column of the CSV must be hostname")
		}
		if idx == 0 || row[0][0:1] == "#" {
			continue
		}

		newSpacesList = append(newSpacesList, strings.ReplaceAll(strings.ReplaceAll(row[0], " ", ""), ",", ""))
	}
	sort.Strings(newSpacesList)
	s.mu.Lock()
	defer s.mu.Unlock()
	currentSpaceList := make([]string, len(*s.MonitorStatus))
	i := 0
	for k := range *s.MonitorStatus {
		currentSpaceList[i] = k
		i++
	}

	sort.Strings(currentSpaceList)
	if !reflect.DeepEqual(currentSpaceList, newSpacesList) {
		newMonitorStatus := make(map[string]*spaceStatus)
		for _, space := range newSpacesList {
			if _, ok := (*s.MonitorStatus)[space]; !ok {
				newMonitorStatus[space] = &spaceStatus{
					StatusDNS: "N/A",
					StatusP2P: "N/A",
				}
			} else {
				newMonitorStatus[space] = (*s.MonitorStatus)[space]
			}
		}
		s.MonitorStatus = &newMonitorStatus
		s.log.Info("Updated Space list", zap.Int("Spaces to monitor", len(newSpacesList)))
	}
	return nil
}
func (s *Srv) scan(timeout time.Duration) {
	s.chScan = make(chan bool)
	for {
		select {
		case <-s.chScan:
			return
		case <-s.ticker.C:
			if err := s.updateSpaceList(); err != nil {
				s.log.Warn("Failed to update space list from CSV", zap.Error(err))
			}
			var wg sync.WaitGroup
			for space, stat := range *s.MonitorStatus {
				wg.Add(1)
				go func(space string, stat *spaceStatus) {
					var err error
					ctx, cancel := context.WithTimeout(context.Background(), timeout)
					defer wg.Done()
					defer cancel()
					lastCheck := time.Now().UTC()
					stat.LastCheck = lastCheck.Format("2006-01-02 15:04:05")
					info, err := s.checkSeedAddrs(ctx, space, "")
					if err != nil {
						checkError := fmt.Errorf("could not get space [%s] address from seed config page: %w", space, err)
						stat.StatusDNS = err.Error()
						stat.StatusP2P = "N/A"
						stat.LastDNSError = lastCheck.Format("2006-01-02 15:04:05") + " " + err.Error()
						s.log.Warn("CheckSeedAddrs error", zap.Error(checkError))
						if !stat.LastOKNotificationSent.Before(stat.LastKONotificationSent) && s.discordClient != nil {
							if err := s.discordClient.SendMessage(space + " has DNS problems: ```" + err.Error() + "```"); err != nil {
								s.log.Warn("Could not send KO Discord notification", zap.Error(err))
							} else {
								stat.LastKONotificationSent = lastCheck
							}
						}
						return
					}
					stat.StatusDNS = "OK"
					lastCheck = time.Now().UTC()

					duration, err := s.checkP2P(ctx, info, s.numPings)
					if err != nil {
						checkError := fmt.Errorf("P2P error [%s]: %w", space, err)
						stat.StatusP2P = "KO"
						stat.LastP2PError = lastCheck.Format("2006-01-02 15:04:05") + " " + err.Error()
						s.log.Warn("CheckP2P error", zap.Error(checkError))
						if !stat.LastOKNotificationSent.Before(stat.LastKONotificationSent) && s.discordClient != nil {
							if err := s.discordClient.SendMessage("Server " + space + " has P2P problems: ```" + err.Error() + "```"); err != nil {
								s.log.Warn("Could not send KO Discord notification", zap.Error(err))
							} else {
								stat.LastKONotificationSent = lastCheck
							}
						}
						return
					}
					stat.StatusP2P = "OK Avg. Ping:" + duration.Round(time.Millisecond).String()

					if stat.LastOKNotificationSent.Before(stat.LastKONotificationSent) && s.discordClient != nil {
						if err := s.discordClient.SendMessage("Server " + space + " is back up again. P2P Ping time: " + duration.Round(time.Millisecond).String()); err != nil {
							s.log.Warn("Could not send Discord OK notification", zap.Error(err))
						} else {
							stat.LastOKNotificationSent = lastCheck
						}
					}

					/*
						if mustInclude != "" {
							for _, addr := range info.Addrs {
								if mustInclude == addr.String() {
									includedAddress = true
									break
								}
							}
							return includedAddress, nil
						}
					*/
				}(space, stat)
			}
			wg.Wait()

		}
	}
}
