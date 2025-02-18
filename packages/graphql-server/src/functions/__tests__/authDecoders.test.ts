import type { APIGatewayProxyEvent, Context } from 'aws-lambda'

import { createLogger } from '@redwoodjs/api/logger'

import { createGraphQLHandler } from '../../functions/graphql'

jest.mock('../../makeMergedSchema', () => {
  const { makeExecutableSchema } = require('@graphql-tools/schema')

  // Return executable schema
  return {
    makeMergedSchema: () =>
      makeExecutableSchema({
        typeDefs: /* GraphQL */ `
          type Query {
            me: User!
          }

          type User {
            id: ID!
            firstName: String!
            lastName: String!
          }
        `,
        resolvers: {
          Query: {
            me: () => {
              const globalContext = require('../../globalContext').context
              const currentUser = globalContext.currentUser

              return {
                id: currentUser.userId,
                firstName: 'Ba',
                lastName: 'Zinga',
              }
            },
          },
        },
      }),
  }
})

jest.mock('../../directives/makeDirectives', () => {
  return {
    makeDirectivesForPlugin: () => [],
  }
})

type Decoded = Record<string, unknown> | null

type Decoder = (
  token: string,
  type: string,
  req: {
    event: APIGatewayProxyEvent
    context: Context
  }
) => Promise<Decoded>

interface MockLambdaParams {
  headers?: { [key: string]: string }
  body?: string | null
  httpMethod: string
  [key: string]: any
}

const mockLambdaEvent = ({
  headers,
  body = null,
  httpMethod,
  ...others
}: MockLambdaParams): APIGatewayProxyEvent => {
  return {
    headers: headers || {},
    body,
    httpMethod,
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    multiValueHeaders: {}, // this is silly - the types require a value. It definitely can be undefined, e.g. on Vercel.
    path: '/graphql',
    pathParameters: null,
    stageVariables: null,
    queryStringParameters: null,
    requestContext: {
      accountId: 'MOCKED_ACCOUNT',
      apiId: 'MOCKED_API_ID',
      authorizer: { name: 'MOCKED_AUTHORIZER' },
      protocol: 'HTTP',
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '123.123.123.123',
        user: null,
        userAgent: null,
        userArn: null,
      },
      httpMethod: 'POST',
      path: '/MOCK_PATH',
      stage: 'MOCK_STAGE',
      requestId: 'MOCKED_REQUEST_ID',
      requestTimeEpoch: 1,
      resourceId: 'MOCKED_RESOURCE_ID',
      resourcePath: 'MOCKED_RESOURCE_PATH',
    },
    resource: 'MOCKED_RESOURCE',
    ...others,
  }
}

describe('createGraphQLHandler', () => {
  beforeAll(() => {
    process.env.DISABLE_CONTEXT_ISOLATION = '1'
  })

  afterAll(() => {
    process.env.DISABLE_CONTEXT_ISOLATION = '0'
  })

  afterEach(() => {
    // Clean up after test cases
    const globalContext = require('../../globalContext').context
    delete globalContext.currentUser
  })

  const adminAuthDecoder: Decoder = async (token, type) => {
    if (type !== 'admin-auth') {
      return null
    }

    return {
      userId: 'admin-one',
      token: token.replace(/-/g, ' '),
    }
  }

  const customerAuthDecoder: Decoder = async (token, type) => {
    if (type !== 'customer-auth') {
      return null
    }

    return {
      userId: 'customer-one',
      token: token.replace(/-/g, ' '),
    }
  }

  const getCurrentUser = async (decoded) => {
    if (decoded.userId === 'admin-one') {
      return { ...decoded, roles: ['admin'] }
    } else if (decoded.userId === 'customer-one') {
      return { ...decoded, roles: ['user'] }
    }
  }

  it('should allow you to pass an auth decoder', async () => {
    const handler = createGraphQLHandler({
      getCurrentUser,
      authDecoder: adminAuthDecoder,
      loggerConfig: { logger: createLogger({}), options: {} },
      sdls: {},
      directives: {},
      services: {},
      onException: () => {},
    })

    const mockedEvent = mockLambdaEvent({
      headers: {
        'Content-Type': 'application/json',
        'auth-provider': 'admin-auth',
        authorization: 'Bearer auth-test-token-admin',
      },
      body: JSON.stringify({ query: '{ me { id, firstName, lastName } }' }),
      httpMethod: 'POST',
    })

    const response = await handler(mockedEvent, {} as Context)

    const body = JSON.parse(response.body)
    const globalContext = require('../../globalContext').context
    const currentUser = globalContext.currentUser

    expect(body.data.me.id).toEqual('admin-one')
    expect(currentUser.userId).toEqual('admin-one')
    expect(currentUser.token).toEqual('auth test token admin')
    expect(currentUser.roles).toEqual(['admin'])
    expect(response.statusCode).toBe(200)
  })

  it('should allow you to pass an array of auth decoders, using the first one to decode', async () => {
    const handler = createGraphQLHandler({
      getCurrentUser,
      authDecoder: [adminAuthDecoder, customerAuthDecoder],
      loggerConfig: { logger: createLogger({}), options: {} },
      sdls: {},
      directives: {},
      services: {},
      onException: () => {},
    })

    const mockedEvent = mockLambdaEvent({
      headers: {
        'Content-Type': 'application/json',
        'auth-provider': 'admin-auth',
        authorization: 'Bearer auth-test-token-admin',
      },
      body: JSON.stringify({ query: '{ me { id, firstName, lastName } }' }),
      httpMethod: 'POST',
    })

    const response = await handler(mockedEvent, {} as Context)

    const body = JSON.parse(response.body)
    const globalContext = require('../../globalContext').context
    const currentUser = globalContext.currentUser

    expect(body.data.me.id).toEqual('admin-one')
    expect(currentUser.userId).toEqual('admin-one')
    expect(currentUser.token).toEqual('auth test token admin')
    expect(currentUser.roles).toEqual(['admin'])
    expect(response.statusCode).toBe(200)
  })

  it('should allow you to pass an array of auth decoders, using the second one to decode', async () => {
    const handler = createGraphQLHandler({
      getCurrentUser,
      authDecoder: [adminAuthDecoder, customerAuthDecoder],
      loggerConfig: { logger: createLogger({}), options: {} },
      sdls: {},
      directives: {},
      services: {},
      onException: () => {},
    })

    const mockedEvent = mockLambdaEvent({
      headers: {
        'Content-Type': 'application/json',
        'auth-provider': 'customer-auth',
        authorization: 'Bearer auth-test-token-customer',
      },
      body: JSON.stringify({ query: '{ me { id, firstName, lastName } }' }),
      httpMethod: 'POST',
    })

    const response = await handler(mockedEvent, {} as Context)

    const body = JSON.parse(response.body)
    const globalContext = require('../../globalContext').context
    const currentUser = globalContext.currentUser

    expect(body.data.me.id).toEqual('customer-one')
    expect(currentUser.userId).toEqual('customer-one')
    expect(currentUser.token).toEqual('auth test token customer')
    expect(currentUser.roles).toEqual(['user'])
    expect(response.statusCode).toBe(200)
  })
})
