import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { Gallery } from "./components/Gallery";
import { About } from "./components/About";
import { Highlights } from "./components/Highlights";
import { Menu } from "./components/Menu";
import { Reviews } from "./components/Reviews";
import { ServiceArea } from "./components/ServiceArea";
import { FAQ } from "./components/FAQ";
import { Location } from "./components/Location";
import { Footer } from "./components/Footer";
import { StickyBar } from "./components/StickyBar";
import { useReveal } from "./hooks/useReveal";

export default function App() {
  useReveal();
  return (
    <>
      <a
        href="#menu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-[var(--color-brand-red)] focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to menu
      </a>
      <Nav />
      <main className="overflow-x-clip pb-24 md:pb-0">
        <Hero />
        <Gallery />
        <About />
        <Highlights />
        <Menu />
        <Reviews />
        <ServiceArea />
        <FAQ />
        <Location />
      </main>
      <Footer />
      <StickyBar />
    </>
  );
}
