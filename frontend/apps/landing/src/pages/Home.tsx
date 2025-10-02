import React from 'react'
import Collaboration from '../components/Collaboration'
import Community from '../components/Community'
import GetStarted from '../components/GetStarted'
import Hero from '../components/Hero'
import Identity from '../components/Identity'
import Linking from '../components/Linking'
import Protocol from '../components/Protocol'
import Publishing from '../components/Publishing'
import Footer from '../layout/Footer'
import Navbar from '../layout/Navbar'

const Home: React.FC = () => {
  return (
    <div>
      <Navbar />
      <main className="pt-20">
        <Hero />
        <Publishing />
        <Identity />
        <Collaboration />
        <Community />
        <Linking />
        <Protocol />
        <GetStarted />
        <Footer />
      </main>
    </div>
  )
}

export default Home
