const assert=require("node:assert/strict")
const fs=require("node:fs")
const path=require("node:path")
const vm=require("node:vm")
const test=require("node:test")
const ts=require("typescript")
const React=require("react")
const {renderToStaticMarkup}=require("react-dom/server")
function load(file,deps={}) {
 const filename=path.join(__dirname,"../src",file)
 const code=ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:filename}).outputText
 const exports={};vm.runInNewContext(code,{exports,require:(name)=>deps[name]??require(name)});return exports
}
const content=load("lib/product-content.ts")
const Details=load("components/product-tabs.tsx",{"@/lib/product-content":content}).default
test("description, details and FAQ answers are present in server HTML without hidden tabs",()=>{
 const html=renderToStaticMarkup(React.createElement(Details,{description:"Everyday protection.\n\nChoose a model.",facts:[{label:"Collection",value:"Bloom"}],content:content.DEFAULT_PRODUCT_CONTENT,isCase:true}))
 assert.ok(html.includes("Everyday protection."));assert.ok(html.includes("Bloom"));assert.ok(html.includes("Select your exact device model"))
 assert.ok(html.includes("<details"));assert.ok(!html.includes('role="tab"'))
})
test("Admin content overrides fallback information, can hide FAQ and renders HTML as text",()=>{
 const settings=content.readProductContent({florayn_product_content:{...content.DEFAULT_PRODUCT_CONTENT,facts:[{label:"Material",value:"Custom details"}],faqs:[{question:"Custom FAQ?",answer:"<script>alert(1)</script>"}]}})
 const html=renderToStaticMarkup(React.createElement(Details,{description:"",facts:[{label:"Fits",value:"old"}],content:settings,isCase:false}))
 assert.ok(html.includes("Custom details"));assert.ok(!html.includes(">old<"));assert.ok(!html.includes("<script>"));assert.ok(html.includes("&lt;script&gt;"))
 const hidden=renderToStaticMarkup(React.createElement(Details,{facts:[],content:{...settings,facts:[],faqs:[]},isCase:false}))
 assert.ok(!hidden.includes("<details"));assert.ok(!hidden.includes("FAQ"))
})

