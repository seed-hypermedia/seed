import {createServer, IncomingMessage, ServerResponse} from 'http'
import {createSchema} from '@shm/graphql-server'
import {createYoga, Plugin} from 'graphql-yoga'
import {GraphQLError} from 'graphql'
import {grpcClient} from './app-grpc'
import * as logger from './logger'
import {DESKTOP_GRAPHQL_PORT} from '@shm/shared/constants'

let server: ReturnType<typeof createServer> | null = null

// Simple depth limit plugin to prevent overly deep recursive queries
function depthLimitPlugin(maxDepth: number): Plugin {
  return {
    onValidate({addValidationRule}) {
      addValidationRule((context: any) => ({
        Field(node: any, _key: any, _parent: any, path: any) {
          const depth = path.filter((p: any) => typeof p === 'string').length
          if (depth > maxDepth) {
            context.reportError(
              new GraphQLError(
                `Query exceeds maximum depth of ${maxDepth}. Found depth of ${depth}.`,
                {nodes: [node]},
              ),
            )
          }
        },
      }))
    },
  }
}

export async function startGraphQLServer(): Promise<number> {
  const graphQLSchema = createSchema(grpcClient)

  // Create Yoga instance with our Pothos schema
  const yoga = createYoga({
    schema: graphQLSchema,
    graphiql: false,
    landingPage: false,
    plugins: [
      // Limit query depth to prevent overly deep recursive queries
      // This protects against deeply nested BlockNode children and embed chains
      depthLimitPlugin(15), // Allow reasonable nesting for content blocks
    ],
    logging: {
      debug: (...args) => logger.debug('[GraphQL]', ...args),
      info: (...args) => logger.info('[GraphQL]', ...args),
      warn: (...args) => logger.warn('[GraphQL]', ...args),
      error: (...args) => logger.error('[GraphQL]', ...args),
    },
  })

  return new Promise((resolve, reject) => {
    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        // Handle CORS
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization',
        )

        if (req.method === 'OPTIONS') {
          res.writeHead(204)
          res.end()
          return
        }

        // Only handle requests to /hm/api/graphql
        if (!req.url?.startsWith('/hm/api/graphql')) {
          res.writeHead(404)
          res.end('Not Found')
          return
        }

        const response = await yoga.fetch(
          new Request(
            `http://localhost:${DESKTOP_GRAPHQL_PORT}${req.url}`,
            {
              method: req.method,
              headers: req.headers as HeadersInit,
              body:
                req.method !== 'GET' && req.method !== 'HEAD'
                  ? await new Promise<string>((resolve) => {
                      let body = ''
                      req.on('data', (chunk) => (body += chunk))
                      req.on('end', () => resolve(body))
                    })
                  : undefined,
            },
          ),
        )

        res.writeHead(response.status, Object.fromEntries(response.headers))
        res.end(await response.text())
      } catch (err) {
        logger.error('[GraphQL] Request error:', err as Error)
        res.writeHead(500)
        res.end('Internal Server Error')
      }
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn(
          `[GraphQL] Port ${DESKTOP_GRAPHQL_PORT} already in use, trying next port`,
        )
        const nextPort = Number(DESKTOP_GRAPHQL_PORT) + 1
        server?.listen(nextPort, () => {
          logger.info(`[GraphQL] Server started on port ${nextPort}`)
          resolve(nextPort)
        })
      } else {
        logger.error('[GraphQL] Server error:', err)
        reject(err)
      }
    })

    server.listen(DESKTOP_GRAPHQL_PORT, () => {
      logger.info(`[GraphQL] Server started on port ${DESKTOP_GRAPHQL_PORT}`)
      resolve(Number(DESKTOP_GRAPHQL_PORT))
    })
  })
}

export function stopGraphQLServer() {
  if (server) {
    server.close()
    server = null
    logger.info('[GraphQL] Server stopped')
  }
}
