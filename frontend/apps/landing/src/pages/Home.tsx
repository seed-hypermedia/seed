import React from "react";
import Collaboration from "../components/Collaboration";
import Hero from "../components/Hero";
import Identity from "../components/Identity";
import Publishing from "../components/Publishing";
import Footer from "../layout/Footer";
import Navbar from "../layout/Navbar";
import Community from "../components/Community";
import Linking from "../components/Linking";
import Protocol from "../components/Protocol";
import GetStarted from "../components/GetStarted";

const Home: React.FC = () => {
  return (
    <div>
      <Navbar />
      <Hero />
      <Publishing />
      <Identity />
      <Collaboration />
      <Community />
      <Linking />
      <Protocol />
      <GetStarted />
      <Footer />
    </div>
  );
};

export default Home;
