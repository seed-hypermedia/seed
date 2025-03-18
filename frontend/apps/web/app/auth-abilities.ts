import {UnpackedHypermediaId} from '@shm/shared'
import {z} from 'zod'

export function getValidAbility(
  abilities: Ability[],
  docId: UnpackedHypermediaId,
  abilityType: 'comment',
  origin: string,
) {
  return abilities.find((ability) => {
    if (ability.delegateOrigin !== origin) {
      return false
    }
    if (ability.targetUid && ability.targetUid !== docId.uid) {
      return false
    }
    return true // todo: check targetPath, recursive, expiration, mode/abilityType
  })
}

export const AbilityModeSchema = z.enum(['comment', 'all'])

export const AbilitySchema = z.object({
  id: z.string(),
  accountUid: z.string(),
  accountPublicKey: z.instanceof(Uint8Array),
  targetPath: z.array(z.string()).nullable(),
  targetUid: z.string().nullable(),
  mode: AbilityModeSchema,
  expiration: z.number().nullable(),
  recursive: z.boolean(),
  delegateOrigin: z.string(),
  identityOrigin: z.string(),
})

export type Ability = z.infer<typeof AbilitySchema>
