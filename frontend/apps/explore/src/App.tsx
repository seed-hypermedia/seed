import {Route, Routes} from 'react-router-dom'
import Feed from './components/Feed'
import HM from './components/HM'
import Home from './components/Home'
import IPFS from './components/IPFS'
import ApiLab from './components/ApiLab'
import Layout from './components/Layout'
import List from './components/List'
import Settings from './components/Settings'

/** Root router for the Explore app. */
function App() {
  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/api-lab" element={<ApiLab />} />
          <Route path="/list" element={<List />} />
          <Route path="/feed" element={<Feed />} />
          <Route path="/hm/*" element={<HM />} />
          <Route path="/ipfs/:cid" element={<IPFS />} />
        </Route>
      </Routes>
      <Settings />
    </>
  )
}

export default App
