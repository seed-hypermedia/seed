import {describe, it, expect} from 'vitest'
import {z} from 'zod'
import {serializeQueryString, deserializeQueryString} from './input-querystring'
import {
  HMCommentRequestSchema,
  HMAccountContactsRequestSchema,
  HMListCommentsInputSchema,
  HMInteractionSummaryInputSchema,
  HMGetCommentReplyCountInputSchema,
  HMSearchInputSchema,
  HMQuerySchema,
} from './hm-types'

describe('input-querystring', () => {
  describe('serializeQueryString', () => {
    it('serializes simple object with primitives', () => {
      const input = {foo: 'bar', baz: 123, x: false}
      const result = serializeQueryString(input)
      expect(result).toBe('?foo=bar&baz=123&x=false')
    })

    it('handles empty object', () => {
      const result = serializeQueryString({})
      expect(result).toBe('')
    })

    it('skips null and undefined values', () => {
      const input = {foo: 'bar', nullValue: null, undefinedValue: undefined}
      const result = serializeQueryString(input)
      expect(result).toBe('?foo=bar')
    })

    it('serializes nested objects as JSON', () => {
      const input = {user: {name: 'John', age: 30}}
      const result = serializeQueryString(input)
      expect(result).toBe(
        '?user=%7B%22name%22%3A%22John%22%2C%22age%22%3A30%7D',
      )
    })

    it('serializes arrays as JSON', () => {
      const input = {tags: ['a', 'b', 'c']}
      const result = serializeQueryString(input)
      expect(result).toBe('?tags=%5B%22a%22%2C%22b%22%2C%22c%22%5D')
    })

    it('handles mixed types', () => {
      const input = {str: 'hello', num: 42, bool: true}
      const result = serializeQueryString(input)
      expect(result).toBe('?str=hello&num=42&bool=true')
    })
  })

  describe('deserializeQueryString', () => {
    it('deserializes simple object preserving types', () => {
      const schema = z.object({
        foo: z.string(),
        baz: z.coerce.number(),
        x: z.coerce.boolean(),
      })

      const queryString = '?foo=bar&baz=123&x=false'
      const result = deserializeQueryString(queryString, schema)

      expect(result).toEqual({foo: 'bar', baz: 123, x: false})
      expect(typeof result.foo).toBe('string')
      expect(typeof result.baz).toBe('number')
      expect(typeof result.x).toBe('boolean')
    })

    it('handles query string without leading ?', () => {
      const schema = z.object({
        foo: z.string(),
      })

      const result = deserializeQueryString('foo=bar', schema)
      expect(result).toEqual({foo: 'bar'})
    })

    it('handles empty query string', () => {
      const schema = z.object({
        foo: z.string().optional(),
      })

      const result = deserializeQueryString('', schema)
      expect(result).toEqual({})
    })

    it('deserializes numbers correctly', () => {
      const schema = z.object({
        a: z.coerce.number(),
      })

      const queryString = '?a=1'
      const result = deserializeQueryString(queryString, schema)

      expect(result).toEqual({a: 1})
      expect(typeof result.a).toBe('number')
      expect(result.a).toBe(1)
      expect(result.a).not.toBe('1')
    })

    it('deserializes booleans correctly', () => {
      const schema = z.object({
        active: z.coerce.boolean(),
        inactive: z.coerce.boolean(),
      })

      const queryString = '?active=true&inactive=false'
      const result = deserializeQueryString(queryString, schema)

      expect(result).toEqual({active: true, inactive: false})
      expect(typeof result.active).toBe('boolean')
      expect(typeof result.inactive).toBe('boolean')
    })

    it('deserializes nested objects from JSON', () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          age: z.number(),
        }),
      })

      const input = {user: {name: 'John', age: 30}}
      const queryString = serializeQueryString(input)
      const result = deserializeQueryString(queryString, schema)

      expect(result).toEqual({user: {name: 'John', age: 30}})
      expect(typeof result.user.age).toBe('number')
    })

    it('deserializes arrays from JSON', () => {
      const schema = z.object({
        tags: z.array(z.string()),
      })

      const input = {tags: ['a', 'b', 'c']}
      const queryString = serializeQueryString(input)
      const result = deserializeQueryString(queryString, schema)

      expect(result).toEqual({tags: ['a', 'b', 'c']})
      expect(Array.isArray(result.tags)).toBe(true)
    })

    it('round-trips correctly with mixed types', () => {
      const schema = z.object({
        str: z.string(),
        num: z.coerce.number(),
        bool: z.coerce.boolean(),
      })

      const original = {str: 'hello', num: 42, bool: true}
      const serialized = serializeQueryString(original)
      const deserialized = deserializeQueryString(serialized, schema)

      expect(deserialized).toEqual(original)
      expect(typeof deserialized.str).toBe('string')
      expect(typeof deserialized.num).toBe('number')
      expect(typeof deserialized.bool).toBe('boolean')
    })

    it('round-trips correctly with numbers', () => {
      const schema = z.object({
        id: z.coerce.number(),
        count: z.coerce.number(),
      })

      const original = {id: 100, count: 0}
      const serialized = serializeQueryString(original)
      const deserialized = deserializeQueryString(serialized, schema)

      expect(deserialized).toEqual(original)
      expect(deserialized.id).toBe(100)
      expect(deserialized.count).toBe(0)
    })

    it('handles optional fields', () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      })

      const queryString = '?required=value'
      const result = deserializeQueryString(queryString, schema)

      expect(result).toEqual({required: 'value'})
    })

    it('validates and coerces types according to schema', () => {
      const schema = z.object({
        age: z.coerce.number().min(0).max(150),
      })

      const queryString = '?age=25'
      const result = deserializeQueryString(queryString, schema)

      expect(result).toEqual({age: 25})
      expect(typeof result.age).toBe('number')
    })

    it('throws error for invalid data according to schema', () => {
      const schema = z.object({
        age: z.coerce.number().min(0).max(150),
      })

      const queryString = '?age=invalid'

      expect(() => deserializeQueryString(queryString, schema)).toThrow()
    })
  })

  describe('non-object input handling', () => {
    it('serializes string input as __value param', () => {
      const result = serializeQueryString('hello-world' as any)
      expect(result).toBe('?__value=hello-world')
    })

    it('serializes number input as __value param', () => {
      const result = serializeQueryString(42 as any)
      expect(result).toBe('?__value=42')
    })

    it('serializes boolean input as __value param', () => {
      const result = serializeQueryString(true as any)
      expect(result).toBe('?__value=true')
    })

    it('deserializes __value param back to string with string schema', () => {
      const schema = z.string()
      const result = deserializeQueryString('?__value=hello-world', schema)
      expect(result).toBe('hello-world')
    })

    it('round-trips string input correctly', () => {
      const original = 'z6MkgacSwts6XqFss1tygbJ3b5YJBpMkSEC8GCSVBBx8ef29'
      const serialized = serializeQueryString(original as any)
      const deserialized = deserializeQueryString(serialized, z.string() as any)
      expect(deserialized).toBe(original)
    })

    it('round-trips string with slashes correctly', () => {
      const original =
        'z6MkgacSwts6XqFss1tygbJ3b5YJBpMkSEC8GCSVBBx8ef29/z6FR5iXwLvU8i8'
      const serialized = serializeQueryString(original as any)
      const deserialized = deserializeQueryString(serialized, z.string() as any)
      expect(deserialized).toBe(original)
    })
  })

  describe('API schema round-trips (client→server simulation)', () => {
    // These tests use the actual HMRequestSchema schemas to simulate
    // what createWebUniversalClient serializes and api.$.tsx deserializes

    it('Comment: string input round-trips through actual schema', () => {
      const inputSchema = HMCommentRequestSchema.shape.input
      const commentId =
        'z6MkgacSwts6XqFss1tygbJ3b5YJBpMkSEC8GCSVBBx8ef29/z6FR5iXwLvU8i8'

      // Client side: serialize
      const queryString = serializeQueryString(commentId)
      // Server side: deserialize
      const deserialized = deserializeQueryString(queryString, inputSchema)

      expect(deserialized).toBe(commentId)
    })

    it('AccountContacts: string input round-trips through actual schema', () => {
      const inputSchema = HMAccountContactsRequestSchema.shape.input
      const uid = 'z6MkgacSwts6XqFss1tygbJ3b5YJBpMkSEC8GCSVBBx8ef29'

      const queryString = serializeQueryString(uid)
      const deserialized = deserializeQueryString(queryString, inputSchema)

      expect(deserialized).toBe(uid)
    })

    it('ListComments: object with unpackedHmId round-trips correctly', () => {
      const input = {
        targetId: {
          id: 'hm://z6MkgacSwts6XqFss1tygbJ3b5YJBpMkSEC8GCSVBBx8ef29',
          uid: 'z6MkgacSwts6XqFss1tygbJ3b5YJBpMkSEC8GCSVBBx8ef29',
          path: [],
          version: null,
          blockRef: null,
          blockRange: null,
          hostname: null,
          scheme: 'hm',
        },
      }

      const queryString = serializeQueryString(input)
      const deserialized = deserializeQueryString(
        queryString,
        HMListCommentsInputSchema,
      )

      expect(deserialized.targetId.uid).toBe(input.targetId.uid)
      expect(deserialized.targetId.version).toBeNull()
    })

    it('InteractionSummary: object with unpackedHmId round-trips correctly', () => {
      const input = {
        id: {
          id: 'hm://z6MkgacSwts6XqFss1tygbJ3b5YJBpMkSEC8GCSVBBx8ef29',
          uid: 'z6MkgacSwts6XqFss1tygbJ3b5YJBpMkSEC8GCSVBBx8ef29',
          path: [],
          version: null,
          blockRef: null,
          blockRange: null,
          hostname: null,
          scheme: 'hm',
        },
      }

      const queryString = serializeQueryString(input)
      const deserialized = deserializeQueryString(
        queryString,
        HMInteractionSummaryInputSchema,
      )

      expect(deserialized.id.uid).toBe(input.id.uid)
      expect(deserialized.id.version).toBeNull()
    })

    it('Query: object with includes array round-trips correctly', () => {
      const input = {
        includes: [
          {
            space: 'z6MkgacSwts6XqFss1tygbJ3b5YJBpMkSEC8GCSVBBx8ef29',
            mode: 'Children' as const,
            path: '/',
          },
        ],
      }

      const queryString = serializeQueryString(input)
      const deserialized = deserializeQueryString(queryString, HMQuerySchema)

      expect(deserialized.includes).toHaveLength(1)
      expect(deserialized.includes[0].space).toBe(input.includes[0].space)
      expect(deserialized.includes[0].mode).toBe('Children')
    })

    it('GetCommentReplyCount: object with string id round-trips correctly', () => {
      const input = {id: 'some-comment-id'}

      const queryString = serializeQueryString(input)
      const deserialized = deserializeQueryString(
        queryString,
        HMGetCommentReplyCountInputSchema,
      )

      expect(deserialized).toEqual(input)
    })

    it('Search: object with optional fields round-trips correctly', () => {
      const input = {query: 'test', includeBody: true}

      const queryString = serializeQueryString(input)
      const deserialized = deserializeQueryString(
        queryString,
        HMSearchInputSchema,
      )

      expect(deserialized.query).toBe('test')
      expect(deserialized.includeBody).toBe(true)
    })
  })

  describe('full round-trip tests', () => {
    it('preserves exact types through serialization and deserialization', () => {
      const schema = z.object({
        stringField: z.string(),
        numberField: z.coerce.number(),
        booleanField: z.coerce.boolean(),
        zeroNumber: z.coerce.number(),
        falsyBoolean: z.coerce.boolean(),
      })

      const original = {
        stringField: 'test',
        numberField: 123,
        booleanField: true,
        zeroNumber: 0,
        falsyBoolean: false,
      }

      const serialized = serializeQueryString(original, schema)
      const deserialized = deserializeQueryString(serialized, schema)

      expect(deserialized).toEqual(original)
      expect(deserialized.numberField).toBe(123)
      expect(deserialized.numberField).not.toBe('123')
      expect(deserialized.zeroNumber).toBe(0)
      expect(deserialized.zeroNumber).not.toBe('0')
      expect(deserialized.falsyBoolean).toBe(false)
      expect(deserialized.falsyBoolean).not.toBe('false')
    })

    it('handles complex nested structures', () => {
      const schema = z.object({
        simple: z.string(),
        count: z.coerce.number(),
        nested: z.object({
          items: z.array(z.number()),
          metadata: z.object({
            created: z.string(),
          }),
        }),
      })

      const original = {
        simple: 'value',
        count: 5,
        nested: {
          items: [1, 2, 3],
          metadata: {
            created: '2025-01-01',
          },
        },
      }

      const serialized = serializeQueryString(original, schema)
      const deserialized = deserializeQueryString(serialized, schema)

      expect(deserialized).toEqual(original)
      expect(typeof deserialized.count).toBe('number')
      expect(Array.isArray(deserialized.nested.items)).toBe(true)
    })
  })
})
