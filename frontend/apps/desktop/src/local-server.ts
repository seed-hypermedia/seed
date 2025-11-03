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

    // Try to find an available port starting from 17654
    const tryPort = (port: number) => {
      server!.listen(port, '127.0.0.1', () => {
        serverPort = port
        logger.info(`[LOCAL-SERVER]: Started on http://127.0.0.1:${port}`)
        resolve(port)
      })

      server!.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE' && port < 17664) {
          // Try next port
          server!.removeAllListeners('error')
          tryPort(port + 1)
        } else {
          reject(err)
        }
      })
    }

    tryPort(17654)
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
