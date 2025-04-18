import {Route, Routes} from "react-router-dom";
import Home from "./components/Home";
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
        </Route>
      </Routes>
      <Settings />
    </>
  );
}

export default App;
