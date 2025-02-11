import {HMMetadata, UnpackedHypermediaId} from '@shm/shared/index'

import {HMBlockNode} from '@shm/shared/index'

export function upgradeNewspaperLayoutModel(
  draftId: UnpackedHypermediaId,
  onMetadata: (values: Partial<HMMetadata>) => void,
  onResetContent: (blockNodes: HMBlockNode[]) => void,
) {
  onMetadata({
    layout: '',
    theme: {
      headerLayout: 'Center',
    },
    showOutline: false,
  })
  onResetContent([
    {
      block: {
        type: 'Query',
        id: 'site-news-query',
        attributes: {
          style: 'Card',
          columnCount: 3,
          banner: true,
          query: {
            includes: [
              {
                space: draftId.uid,
                path: '',
                mode: 'AllDescendants',
              },
            ],
            sort: [
              {
                reverse: false,
                term: 'UpdateTime',
              },
            ],
          },
        },
      },
      children: [],
    },
  ])
}
