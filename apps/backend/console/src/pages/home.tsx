import { Icon } from "../ui"

export default function Home() {
  return <>
    <div className="page-head"><div><h1>Welcome back</h1><p className="muted">Florayn's own admin. More of the shop moves in here step by step.</p></div></div>
    <div className="home-tiles">
      <a href="#/mockup-studio"><div className="card"><span style={{ color: "var(--purple)", width: 26, height: 26 }}>{Icon.sparkles}</span><h2>Mockup Studio</h2><p className="muted">Upload a flat design, pick the models, get every mockup and publish the product.</p></div></a>
      <a href="#/models"><div className="card"><span style={{ width: 26, height: 26 }}>{Icon.phone}</span><h2>Models</h2><p className="muted">Add a new phone model, show or hide models in the store, set badges like New.</p></div></a>
      <a href="/app" target="_blank" rel="noreferrer"><div className="card"><span style={{ width: 26, height: 26 }}>{Icon.external}</span><h2>Classic admin</h2><p className="muted">Orders, products and settings that have not moved here yet.</p></div></a>
      <div className="card soon"><h2>Coming next</h2><p className="muted">Orders and products, designed for the phone.</p></div>
    </div>
  </>
}
