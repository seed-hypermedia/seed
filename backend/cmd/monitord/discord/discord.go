// Package discord implements discord communication.
package discord

import (
	"github.com/bwmarrin/discordgo"
	"go.uber.org/zap"
)

// BotClient is a service that communicates with discord.
type BotClient struct {
	session *discordgo.Session
	log     *zap.Logger
	chanID  string
}

// NewBot creates a bot.
func NewBot(log *zap.Logger, token, discordChannelID string) (*BotClient, error) {
	bc := &BotClient{log: log, chanID: discordChannelID}
	var err error
	bc.session, err = discordgo.New("Bot " + token)
	if err != nil {
		log.Warn("Can't create a discord session", zap.Error(err))
		return nil, err
	}
	bc.session.Identify.Intents = discordgo.MakeIntent(discordgo.IntentsDirectMessages + discordgo.IntentGuildMessages)
	err = bc.session.Open()
	if err != nil {
		log.Warn("error opening connection", zap.Error(err))
		return nil, err
	}
	log.Info("Connected to Discord server")

	return bc, nil
}

// SendMessage sends a message to a channel.
func (bc *BotClient) SendMessage(message string) error {
	_, err := bc.session.ChannelMessageSend(bc.chanID, message)
	return err
}
