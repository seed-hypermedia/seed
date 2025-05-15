import React from 'react';

const Hero: React.FC = () => {
  return (
    <section className="bg-gray-100 text-center py-20">
      <h1 className="text-4xl font-bold text-blue-600 mb-4">Welcome to Seed</h1>
      <p className="text-xl text-gray-600">Publish your content to the web like never before!</p>
      <a href="#get-started" className="bg-blue-600 text-white py-2 px-4 rounded mt-6 inline-block">Get Started</a>
    </section>
  );
};

export default Hero;