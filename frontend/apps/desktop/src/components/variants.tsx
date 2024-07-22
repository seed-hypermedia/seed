import {NavRoute} from '@/utils/routes'

export function VersionContext({route}: {route: NavRoute}) {
  // TODO, bring this back to show the user when they are looking at an older version of a document
  // let exactVersion: string | null = null
  // let fullUrl: string | null = null
  // const navigate = useNavigate()
  // let unpackedId: UnpackedHypermediaId | null = null
  // let latestVersionRoute: NavRoute | null = null
  // const gwUrl = useGatewayUrl()
  // const pubRoute = route.key === 'document' ? route : null
  // const entity = useEntity(unpackHmId(pubRoute?.id), {
  //   enabled: !!pubRoute?.documentId,
  // })
  // if (route.key === 'document') {
  //   const {accessory, documentId, versionId} = route
  //   unpackedId = unpackHmId(documentId)
  //   exactVersion = versionId || null
  //   if (
  //     versionId &&
  //     entity.data?.document?.version &&
  //     entity.data?.document?.version !== versionId
  //   ) {
  //     latestVersionRoute = {
  //       key: 'document',
  //       documentId,
  //       accessory,
  //       versionId: undefined,
  //     }
  //   }
  // }
  // fullUrl =
  //   unpackedId &&
  //   exactVersion &&
  //   createPublicWebHmUrl(unpackedId.type, unpackedId.eid, {
  //     version: exactVersion,
  //     hostname: gwUrl.data,
  //   })
  // if (!unpackedId || !exactVersion || !fullUrl) return null
  // if (!latestVersionRoute) return null
  // return (
  //   <>
  //     <XStack gap="$2" ai="center">
  //       {latestVersionRoute ? (
  //         <View className="no-window-drag">
  //           <Tooltip
  //             content={`You are looking at an older version of this ${HYPERMEDIA_ENTITY_TYPES[
  //               unpackedId.type
  //             ].toLowerCase()}. Click to go to the latest ${
  //               unpackedId.type === 'd' ? 'in this variant' : 'version'
  //             }.`}
  //           >
  //             <Button
  //               size="$2"
  //               theme="blue"
  //               onPress={() => {
  //                 latestVersionRoute && navigate(latestVersionRoute)
  //               }}
  //               iconAfter={ArrowRight}
  //             >
  //               Latest Version
  //             </Button>
  //           </Tooltip>
  //         </View>
  //       ) : null}
  //     </XStack>
  //   </>
  // )
}
