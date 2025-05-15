import React from 'react';
import Navbar from '../components/Navbar';
import Hero from '../components/Hero';
import Footer from '../components/Footer';

const Home: React.FC = () => {
  return (
    <><div className="bg-red-500 text-white p-4 text-center">
    Tailwind is working!
  </div><div>
      <Navbar />
      <Hero />
      <Footer />
    </div>
    </>
    
  );
};

export default Home;