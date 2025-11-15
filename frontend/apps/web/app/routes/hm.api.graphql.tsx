import {graphQLSchema} from '@/graphql/schema'
import {ActionFunction, LoaderFunction} from '@remix-run/node'
import {createYoga, Plugin} from 'graphql-yoga'
import {GraphQLError} from 'graphql'

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
})

// Handle both GET (for GraphiQL) and POST (for queries)
export const loader: LoaderFunction = async ({request}) => {
  return yoga.fetch(request, {})
}

export const action: ActionFunction = async ({request}) => {
  return yoga.fetch(request, {})
}
