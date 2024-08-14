import {
  useAddCapabilities,
  useAllDocumentCapabilities,
  useMyCapability,
} from '@/models/access-control'
import {useSearch} from '@/models/search'
import {DocumentRoute} from '@/utils/routes'
import {Role, UnpackedHypermediaId, unpackHmId} from '@shm/shared'
import {Button, Input, Label, SizableText, Text} from '@shm/ui'
import {useState} from 'react'
import {AccessoryContainer} from './accessory-sidebar'

export function CollaboratorsPanel({
  route,
  onClose,
}: {
  route: DocumentRoute
  onClose: () => void
}) {
  return (
    <AccessoryContainer title="Collaborators" onClose={onClose}>
      <AddCollaboratorForm id={route.id} />
      <Label>Collaborators</Label>
      <CollaboratorsList id={route.id} />
    </AccessoryContainer>
  )
}

type SearchResult = {
  id: UnpackedHypermediaId
  label: string
}

function AddCollaboratorForm({id}: {id: UnpackedHypermediaId}) {
  const myCapability = useMyCapability(id, 'admin')
  const addCapabilities = useAddCapabilities(id)
  const [selectedCollaborators, setSelectedCollaborators] = useState<
    SearchResult[]
  >([])
  const [search, setSearch] = useState('')
  const searchResults = useSearch(search, {})
  if (!myCapability) return null
  return (
    <>
      <Label>Add Collaborator</Label>
      {selectedCollaborators.map((collab) => (
        <SizableText key={collab.id.id}>{collab.label}</SizableText>
      ))}
      <Input
        value={search}
        onChangeText={(searchText: string) => {
          console.log(searchText)
          setSearch(searchText)
        }}
      />
      {searchResults.data
        ?.map((result) => {
          const id = unpackHmId(result.id)
          if (!id) return null
          return {id, label: result.title}
        })
        .filter((result) => {
          if (!result) return false // probably id was not parsed correctly
          if (result.id.path?.length) return false // this is a directory document, not an account
          if (result.id.uid === id.uid) return false // this account is already the owner, cannot be added
          if (
            selectedCollaborators.find(
              (collab) => collab.id.id === result.id.id,
            )
          )
            return false // already added
          return true
        })
        .map(
          (result) =>
            result && (
              <SearchResultItem
                key={result.id.id}
                result={result}
                onSelect={() => {
                  setSelectedCollaborators((collabs) => [...collabs, result])
                }}
              />
            ),
        )}
      {/* <SelectDropdown options={RoleOptions} onSelect={() = > {}} /> // not relevant yet because we can only add writers
       */}
      <Text>{JSON.stringify(myCapability)}</Text>
      <Button
        onPress={() => {
          addCapabilities.mutate({
            myCapability: myCapability,
            collaboratorAccountIds: selectedCollaborators.map(
              (collab) => collab.id.uid,
            ),
            role: Role.WRITER,
          })
        }}
      >
        Add Writers
      </Button>
    </>
  )
}

function SearchResultItem({
  result,
  onSelect,
}: {
  result: SearchResult
  onSelect: () => void
}) {
  return <Button onPress={onSelect}>{result.label}</Button>
}

function CollaboratorsList({id}: {id: UnpackedHypermediaId}) {
  const capabilities = useAllDocumentCapabilities(id)
  return capabilities.data?.map((capability) => {
    return (
      <SizableText>
        {capability.account} - {capability.role}
      </SizableText>
    )
  })
  return null
}
