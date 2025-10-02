const { exec } = require('child_process')
const util = require('util')
const fs = require('fs')
const path = require('path')
const execAsync = util.promisify(exec)

console.log('🧹 Starting cleanup process...')

async function cleanDirectories() {
  try {
    const directories = [
      path.join(__dirname, '..', 'frontend', 'apps', 'desktop', '.vite'),
      path.join(__dirname, '..', 'frontend', 'apps', 'desktop', 'out'),
      path.join(
        __dirname,
        '..',
        'frontend',
        'apps',
        'desktop',
        'node_modules',
        '.vite',
      ),
    ]

    for (const dir of directories) {
      if (fs.existsSync(dir)) {
        console.log(`🗑️  Removing directory: ${dir}`)
        fs.rmSync(dir, { recursive: true, force: true })
        console.log(`✅ Removed ${path.basename(dir)}`)
      } else {
        console.log(`✨ Directory doesn't exist: ${path.basename(dir)}`)
      }
    }
  } catch (error) {
    console.error('❌ Error cleaning directories:', error)
  }
}

async function killProcess(pid) {
  try {
    // Send SIGTERM first for graceful shutdown
    await execAsync(`kill -15 ${pid}`)
    console.log(`✅ Sent SIGTERM to process ${pid}`)

    // Wait a bit to let the process cleanup
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Check if process still exists
    try {
      await execAsync(`ps -p ${pid}`)
      // If we get here, process still exists, force kill it
      await execAsync(`kill -9 ${pid}`)
      console.log(`⚡ Force killed process ${pid}`)
    } catch {
      // Process doesn't exist anymore, SIGTERM worked
      console.log(`✅ Process ${pid} terminated gracefully`)
    }
  } catch (error) {
    console.error(`❌ Error killing process ${pid}:`, error)
  }
}

async function killPort(port) {
  try {
    console.log(`⏳ Checking port ${port}...`)
    const { stdout } = await execAsync(`lsof -ti:${port}`)

    if (stdout.trim()) {
      const pids = stdout.trim().split('\n')
      for (const pid of pids) {
        console.log(`🔎 Found process using port ${port}: PID ${pid}`)
        await killProcess(pid)
      }
    } else {
      console.log(`✨ No process found using port ${port}`)
    }
  } catch (error) {
    if (error.code === 1) {
      console.log(`✨ Port ${port} is already free`)
    } else {
      console.error(`❌ Error checking port ${port}:`, error)
    }
  }
}

async function cleanup() {
  try {
    // Clean build and cache directories
    await cleanDirectories()

    // Kill processes on commonly used ports
    await killPort(5173)
    await killPort(5174)

    // Wait a moment to ensure everything is cleaned up
    console.log('⏳ Waiting for cleanup to complete...')
    await new Promise((resolve) => setTimeout(resolve, 1000))
    console.log('✅ Cleanup completed')
  } catch (error) {
    console.error('💥 Fatal error:', error)
    process.exit(1)
  }
}

// Handle cleanup on script termination
process.on('SIGINT', async () => {
  console.log('\n🛑 Caught interrupt signal, cleaning up...')
  try {
    await cleanup()
    console.log('✅ Cleanup successful, exiting...')
    process.exit(0)
  } catch (error) {
    console.error('❌ Error during cleanup:', error)
    process.exit(1)
  }
})

cleanup().then(() => {
  console.log('🎉 Cleanup script finished')
})
