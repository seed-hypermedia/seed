import React from "react";
import Hero from "../components/Hero";
import Publishing from "../components/Publishing";
import Footer from "../layout/Footer";
import Navbar from "../layout/Navbar";

const Home: React.FC = () => {
  return (
    <div>
      <Navbar />
      <Hero />
      <Publishing />
      <Footer />
    </div>
  );
};

export default Home;
