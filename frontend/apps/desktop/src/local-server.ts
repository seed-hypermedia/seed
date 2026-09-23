import * as http from 'http'
import * as fs from 'fs'
import mime from 'mime'
import * as path from 'path'
import * as logger from './logger'

let server: http.Server | null = null
let serverPort: number | null = null

export function startLocalServer(staticPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      if (serverPort) {
        resolve(serverPort)
      }
      return
    }

    server = http.createServer((req, res) => {
      let urlPath = req.url || '/'

      // Remove query parameters
      urlPath = urlPath.split('?')[0]

      // Default to index.html for root
      if (urlPath === '/') {
        urlPath = '/index.html'
      }

      const filePath = path.join(staticPath, urlPath)

      // Security: prevent directory traversal
      if (!filePath.startsWith(staticPath)) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }

      fs.readFile(filePath, (err, content) => {
        if (err) {
          if (err.code === 'ENOENT') {
            // File not found, try index.html (for SPA routing)
            const indexPath = path.join(staticPath, 'index.html')
            fs.readFile(indexPath, (indexErr, indexContent) => {
              if (indexErr) {
                res.writeHead(404)
                res.end('Not found')
              } else {
                res.writeHead(200, {
                  'Content-Type': 'text/html',
                  'Cache-Control': 'no-cache',
                })
                res.end(indexContent)
              }
            })
          } else {
            res.writeHead(500)
            res.end(`Server error: ${err.code}`)
          }
        } else {
          const mimeType = mime.getType(filePath) || 'application/octet-stream'
          res.writeHead(200, {
            'Content-Type': mimeType,
            'Cache-Control': 'no-cache',
          })
          res.end(content)
        }
      })
    })

    // The start port is overridable so an isolated instance (e2e) never lands on the same port
    // as a production app already running on this machine — both would otherwise contend for
    // 17654, and a mixed IPv4/IPv6 bind could serve one instance the other's renderer.
    const startPort = Number(process.env.SEED_LOCAL_SERVER_PORT) || 17654
    const maxPort = startPort + 10
    const tryPort = (port: number) => {
      server!.listen(port, 'localhost', () => {
        serverPort = port
        logger.info(`[LOCAL-SERVER]: Started on http://localhost:${port}`)
        resolve(port)
      })

      server!.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE' && port < maxPort) {
          // Try next port
          server!.removeAllListeners('error')
          tryPort(port + 1)
        } else {
          reject(err)
        }
      })
    }

    tryPort(startPort)
  })
}

export function stopLocalServer() {
  if (server) {
    server.close()
    server = null
    serverPort = null
    logger.info('[LOCAL-SERVER]: Stopped')
  }
}
