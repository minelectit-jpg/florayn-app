const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const test = require("node:test")
const ts = require("typescript")
class MedusaError extends Error { static Types = { INVALID_DATA:"invalid", NOT_FOUND:"not_found", UNAUTHORIZED:"unauthorized", NOT_ALLOWED:"not_allowed" }; constructor(type,message){super(message);this.type=type} }
const utils = { MedusaError, Modules: { PRODUCT:"product", CUSTOMER:"customer" } }
function load(file, deps={}) {
 const filename=path.join(__dirname,"../src",file)
 const code=ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText
 const exports={}
 vm.runInNewContext(code,{exports,Date,process:{env:{R2_PUBLIC_URL:"https://pub-fixture.r2.dev"}},require:(name)=>deps[name] ?? (name==="@medusajs/framework/utils"?utils: (()=>{throw new Error(name)})())})
 return exports
}
const content=load("lib/product-content.ts")
const reviews=load("lib/product-reviews.ts",{"../modules/content":{CONTENT_MODULE:"content"},"./product-content":content})
const plain=(v)=>JSON.parse(JSON.stringify(v))
test("product content preserves automatic, hidden and custom FAQ/information modes",()=>{
 const input={...content.DEFAULT_PRODUCT_CONTENT,faqs:[{question:" Fit? ",answer:" Choose a model. "}],facts:[],reviews_enabled:false}
 assert.deepEqual(plain(content.productContent(input)),{...input,faqs:[{question:"Fit?",answer:"Choose a model."}]})
 assert.equal(content.productContent({...input,faqs:null}).faqs,null)
 for(const patch of [{faqs:Array(13).fill(input.faqs[0])},{facts:[{label:"",value:"x"}]},{faqs:[input.faqs[0],input.faqs[0]]},{reviews_enabled:"false"},{reviews_heading:"x".repeat(81)}])assert.throws(()=>content.productContent({...input,...patch}))
})
test("review input excludes server-controlled moderation and identity fields",()=>{
 const valid={author:" Alex ",title:" Good fit ",body:" A useful everyday case. ",rating:4,status:"approved",customer_id:"intruder",reply:"Fake reply"}
 assert.deepEqual(plain(reviews.reviewInput(valid)),{author:"Alex",title:"Good fit",body:"A useful everyday case.",rating:4,images:[]})
 // florayn.com reviews have no headline and can be two words ("Great 👍").
 assert.equal(reviews.reviewInput({...valid,title:"",body:"Nice case"}).title,"")
 for(const patch of [{rating:0},{rating:5.5},{body:"x"},{title:"x".repeat(121)},{author:"email@example.invalid"},{images:["https://evil.invalid/a.jpg"]},{images:"x"}])assert.throws(()=>reviews.reviewInput({...valid,...patch}))
})
test("only published, review-enabled products expose reviews; all forms of a design share a key",async()=>{
 const product={id:"phone",status:"published",metadata:{design_slug:"bloom"}}
 const container={resolve:()=>({retrieveProduct:async()=>product})}
 assert.equal((await reviews.reviewProduct(container,"phone")).key,"design:bloom")
 product.id="airpods";assert.equal((await reviews.reviewProduct(container,"airpods")).key,"design:bloom")
 product.status="draft";await assert.rejects(reviews.reviewProduct(container,"airpods"),/unavailable/)
 product.status="published";product.metadata={florayn_product_content:{...content.DEFAULT_PRODUCT_CONTENT,reviews_enabled:false}}
 await assert.rejects(reviews.reviewProduct(container,"airpods"),/unavailable/)
})
test("public reviews paginate six approved records, calculate all-rating totals and omit private fields",async()=>{
 const reads=[]
 const row={id:"r1",author:"Alex",rating:5,title:"Nice",body:"A useful case",reply:"Thank you",created_at:"2026-09-23",customer_id:"private",product_id:"p1",status:"approved"}
 const service={listProductReviews:async(filter,opts)=>{reads.push([filter,opts]);return[row]},listAndCountProductReviews:async(filter,opts)=>{reads.push([filter,opts]);return[[],[0,1,0,2,7][filter.rating-1]]}}
 const container={resolve:(key)=>key==="product"?{retrieveProduct:async()=>({id:"p1",status:"published",metadata:{}})}:service}
 const result=await reviews.publicReviews(container,"p1",6)
 assert.equal(result.count,10);assert.equal(result.average,4.5);assert.equal(result.reviews[0].customer_id,undefined)
 assert.equal(reads[0][1].take,6);assert.equal(reads[0][1].skip,6)
 assert.ok(reads.every(([filter])=>filter.status==="approved"&&filter.review_key==="product:p1"))
})
test("page-content workflow preserves other metadata and uses core product update",async()=>{
 const steps={}
 const sdk={createStep:(name,fn)=>{steps[name]=fn;return()=>({})},createWorkflow:()=>()=>{},StepResponse:class{constructor(value){this.value=value}},WorkflowResponse:class{}}
 load("workflows/save-product-content.ts",{"@medusajs/framework/workflows-sdk":sdk,"@medusajs/medusa/core-flows":{updateProductsWorkflow:{runAsStep:()=>{}}},"../lib/product-content":content})
 const received=await steps["prepare-product-page-content"]({productId:"p1",settings:content.DEFAULT_PRODUCT_CONTENT},{container:{resolve:()=>({retrieveProduct:async()=>({id:"p1",metadata:{card:{keep:true},design_slug:"bloom"}})})}})
 assert.equal(received.value.update.metadata.design_slug,"bloom")
 assert.deepEqual(plain(received.value.update.metadata.card),{keep:true})
})
test("review POST requires customer authentication while reads stay public",()=>{
 let config
 load("api/middlewares.ts",{"@medusajs/framework/http":{authenticate:(actor,methods)=>({actor,methods}),defineMiddlewares:(value)=>{config=value;return value}},"../lib/revalidate-storefront":{},"../lib/storefront-write-domains":{}})
 const route=config.routes.find((r)=>r.matcher==="/store/product-reviews")
 assert.deepEqual(plain(route.method),["POST"]);assert.equal(route.middlewares[0].actor,"customer")
})

test("review photos must be this store's own uploads, within the limit",()=>{
 const valid={author:"Alex",title:"",body:"Lovely case",rating:5}
 const photo=(n)=>`https://pub-fixture.r2.dev/reviews/2026/09/${n}.jpg`
 assert.deepEqual(plain(reviews.reviewInput({...valid,images:[photo(1),photo(1),photo(2)]},3).images),[photo(1),photo(2)],"duplicates collapse")
 assert.throws(()=>reviews.reviewInput({...valid,images:[photo(1),photo(2)]},1),/up to 1/)
 assert.throws(()=>reviews.reviewInput({...valid,images:["https://pub-fixture.r2.dev/site/logo.webp"]}),/uploaded here/)
 assert.throws(()=>reviews.reviewInput({...valid,images:["https://pub-fixture.r2.dev/reviews/../site/x.jpg"]}))
 const shown=plain(reviews.publicReview({id:"r",author:"A",rating:5,title:"",body:"b",reply:"",created_at:"x",images:[photo(1)],verified:true,email:"private@example.invalid",coupon_code:"REVPRIVATE"}))
 assert.deepEqual(shown.images,[photo(1)])
 assert.equal(shown.verified,true)
 assert.ok(!JSON.stringify(shown).includes("private@") && !JSON.stringify(shown).includes("REVPRIVATE"),"email and code stay private")
})
