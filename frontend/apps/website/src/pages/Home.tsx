import React from "react";
import Collaboration from "../components/Collaboration";
import Hero from "../components/Hero";
import Identity from "../components/Identity";
import Publishing from "../components/Publishing";
import Footer from "../layout/Footer";
import Navbar from "../layout/Navbar";
import Community from "../components/Community";

const Home: React.FC = () => {
  return (
    <div>
      <Navbar />
      <Hero />
      <Publishing />
      <Identity />
      <Collaboration />
      <Community />
      <Footer />
    </div>
  );
};

export default Home;
