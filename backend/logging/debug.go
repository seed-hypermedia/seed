package logging

import (
	"encoding/json"
	"html/template"
	"net/http"
)

var tpl = template.Must(template.New("").Parse(`
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Seed Daemon Logs</title>
    <style>
      table { border-collapse: collapse; }
      th, td { border: 1px solid black; padding: 5px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Seed Daemon Logs</h1>
      <table>
        <tr>
          <th>Log Name (Subsystem)</th>
          <th>Level</th>
        </tr>
        <tr>
          <td>All Loggers</td>
          <td>
         	<select onchange="updateLogLevel('*', this.value)">
              <option value="">Select global level</option>
              <option value="debug">debug</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
          </td>
        </tr>
        {{range .Logs}}
        <tr>
          <td>{{.Subsystem}}</td>
          <td>
            <select onchange="updateLogLevel('{{.Subsystem}}', this.value)">
              <option value="debug" {{if eq .Level "debug"}}selected{{end}}>debug</option>
              <option value="info" {{if eq .Level "info"}}selected{{end}}>info</option>
              <option value="warn" {{if eq .Level "warn"}}selected{{end}}>warn</option>
              <option value="error" {{if eq .Level "error"}}selected{{end}}>error</option>
            </select>
          </td>
        </tr>
        {{end}}
      </table>
    </main>
    <script>
      function updateLogLevel(subsystem, level) {
        if (!level) {
          return
        }

        fetch(window.location.pathname, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ subsystem, level }),
        })
        .then(response => response.json())
        .then(data => {
          if (!data.success) {
            alert('Failed to update log level')
          }

          if (subsystem === "*") {
            window.location.reload()
          }
        })
        .catch((error) => {
          console.error('Error:', error);
        });
      }
    </script>
  </body>
</html>
`))

func DebugHandler() http.Handler {
	type logInfo struct {
		Subsystem string
		Level     string
	}

	type indexModel struct {
		Logs []logInfo
	}

	handleGet := func(w http.ResponseWriter, _ *http.Request) {
		logs := ListLogNames()

		data := indexModel{
			Logs: make([]logInfo, len(logs)),
		}

		for i, l := range logs {
			data.Logs[i].Subsystem = l
			data.Logs[i].Level = GetLogLevel(l).String()
		}

		w.Header().Set("Content-Type", "text/html")

		if err := tpl.Execute(w, data); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	handlePost := func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Subsystem string `json:"subsystem"`
			Level     string `json:"level"`
		}

		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if err := SetLogLevelErr(in.Subsystem, in.Level); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]bool{"success": true}); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			handleGet(w, r)
		case http.MethodPost:
			handlePost(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})
}
