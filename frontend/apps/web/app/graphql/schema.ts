import {grpcClient} from '@/client.server'
import {createSchema} from '@shm/graphql-server'

// Create the schema with the web app's grpcClient
export const graphQLSchema = createSchema(grpcClient)

// Re-export the schema creation function for other uses
export {createSchema}
