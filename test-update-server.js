const express = require('express')
const app = express()
const port = 3001

// Mock update info that triggers an update
const mockUpdateInfo = {
  name: '2025.12.31-dev.999', // Higher version than current
  release_notes: 'Test update for debugging auto-update process',
  assets: {
    linux: {
      deb: {
        download_url: 'http://localhost:3001/fake-download.deb',
        size: 1024000
      },
      rpm: {
        download_url: 'http://localhost:3001/fake-download.rpm', 
        size: 1024000
      }
    },
    macos: {
      x64: {
        download_url: 'http://localhost:3001/fake-download-x64.zip',
        zip_url: 'http://localhost:3001/fake-download-x64.zip',
        size: 1024000
      },
      arm64: {
        download_url: 'http://localhost:3001/fake-download-arm64.zip',
        zip_url: 'http://localhost:3001/fake-download-arm64.zip', 
        size: 1024000
      }
    },
    windows: {
      exe: {
        download_url: 'http://localhost:3001/fake-download.exe',
        size: 1024000
      }
    }
  }
}

app.get('/latest.json', (req, res) => {
  console.log('Update check requested')
  res.json(mockUpdateInfo)
})

// Mock download endpoints that create fake files
app.get('/fake-download.*', (req, res) => {
  console.log(`Mock download requested: ${req.path}`)
  
  // Create a small fake file content
  const fakeFileContent = Buffer.alloc(1024, 'fake installer data')
  
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Content-Length', fakeFileContent.length)
  res.setHeader('Content-Disposition', `attachment; filename="${req.path.substring(1)}"`)
  
  res.send(fakeFileContent)
})

app.listen(port, () => {
  console.log(`Mock update server running at http://localhost:${port}`)
  console.log('Use this URL for testing: http://localhost:3001/latest.json')
})