import {Route, Routes} from "react-router-dom";
import HM from "./components/HM";
import Home from "./components/Home";
import IPFS from "./components/IPFS";
import Layout from "./components/Layout";
import List from "./components/List";
import Settings from "./components/Settings";

function App() {
  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/list" element={<List />} />
          <Route path="/" element={<Home />} />
          <Route path="/hm/*" element={<HM />} />
          <Route path="/ipfs/:cid" element={<IPFS />} />
        </Route>
      </Routes>
      <Settings />
    </>
  );
}

export default App;
