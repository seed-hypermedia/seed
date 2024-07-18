import {DocumentsFullList} from '@/components/document-list'
import Footer from '@/components/footer'
import {MainWrapperNoScroll} from '@/components/main-wrapper'
import {Container, PageHeading} from '@shm/ui'

export default function ExplorePage() {
  return (
    <>
      <MainWrapperNoScroll>
        <DocumentsFullList
          header={
            <Container>
              <PageHeading>Explore</PageHeading>
            </Container>
          }
        />
      </MainWrapperNoScroll>
      <Footer />
    </>
  )
}
