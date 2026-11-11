import{g as H,e as J,h as K,k as Q,F as Y,E as ee,l as s,o as w,m as te,S as ae,W as ie,X as re,q as se,L as oe,T as ne}from"./index-3tWwjsVi.js";import{p as le}from"./chunk-4BX2VUAB-BY2i0BfZ.js";import{p as ce}from"./wardley-L42UT6IY-BivwGu4d.js";import{d as L}from"./arc-DClfVtST.js";import{o as de}from"./ordinal-Cboi1Yqb.js";import{d as pe}from"./pie-_Z8iBNUw.js";import"./init-Gi6I4Gst.js";var ge=ne.pie,C={sections:new Map,showData:!1},f=C.sections,D=C.showData,he=structuredClone(ge),fe=s(()=>structuredClone(he),"getConfig"),ue=s(()=>{f=new Map,D=C.showData,oe()},"clear"),me=s(({label:e,value:a})=>{if(a<0)throw new Error(`"${e}" has invalid value: ${a}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);f.has(e)||(f.set(e,a),w.debug(`added new section: ${e}, with value: ${a}`))},"addSection"),ve=s(()=>f,"getSections"),Se=s(e=>{D=e},"setShowData"),xe=s(()=>D,"getShowData"),M={getConfig:fe,clear:ue,setDiagramTitle:ee,getDiagramTitle:Y,setAccTitle:Q,getAccTitle:K,setAccDescription:J,getAccDescription:H,addSection:me,getSections:ve,setShowData:Se,getShowData:xe},we=s((e,a)=>{le(e,a),a.setShowData(e.showData),e.sections.map(a.addSection)},"populateDb"),Ce={parse:s(async e=>{const a=await ce("pie",e);w.debug(a),we(a,M)},"parse")},De=s(e=>`
  .pieCircle{
    stroke: ${e.pieStrokeColor};
    stroke-width : ${e.pieStrokeWidth};
    opacity : ${e.pieOpacity};
  }
  .pieOuterCircle{
    stroke: ${e.pieOuterStrokeColor};
    stroke-width: ${e.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${e.pieTitleTextSize};
    fill: ${e.pieTitleTextColor};
    font-family: ${e.fontFamily};
  }
  .slice {
    font-family: ${e.fontFamily};
    fill: ${e.pieSectionTextColor};
    font-size:${e.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${e.pieLegendTextColor};
    font-family: ${e.fontFamily};
    font-size: ${e.pieLegendTextSize};
  }
`,"getStyles"),$e=De,ye=s(e=>{const a=[...e.values()].reduce((r,n)=>r+n,0),$=[...e.entries()].map(([r,n])=>({label:r,value:n})).filter(r=>r.value/a*100>=1);return pe().value(r=>r.value).sort(null)($)},"createPieArcs"),Te=s((e,a,$,y)=>{w.debug(`rendering pie chart
`+e);const r=y.db,n=te(),T=ae(r.getConfig(),n.pie),A=40,o=18,p=4,c=450,d=c,u=ie(a),l=u.append("g");l.attr("transform","translate("+d/2+","+c/2+")");const{themeVariables:i}=n;let[E]=re(i.pieOuterStrokeWidth);E??=2;const b=T.textPosition,g=Math.min(d,c)/2-A,G=L().innerRadius(0).outerRadius(g),B=L().innerRadius(g*b).outerRadius(g*b);l.append("circle").attr("cx",0).attr("cy",0).attr("r",g+E/2).attr("class","pieOuterCircle");const h=r.getSections(),O=ye(h),P=[i.pie1,i.pie2,i.pie3,i.pie4,i.pie5,i.pie6,i.pie7,i.pie8,i.pie9,i.pie10,i.pie11,i.pie12];let m=0;h.forEach(t=>{m+=t});const k=O.filter(t=>(t.data.value/m*100).toFixed(0)!=="0"),v=de(P).domain([...h.keys()]);l.selectAll("mySlices").data(k).enter().append("path").attr("d",G).attr("fill",t=>v(t.data.label)).attr("class","pieCircle"),l.selectAll("mySlices").data(k).enter().append("text").text(t=>(t.data.value/m*100).toFixed(0)+"%").attr("transform",t=>"translate("+B.centroid(t)+")").style("text-anchor","middle").attr("class","slice");const I=l.append("text").text(r.getDiagramTitle()).attr("x",0).attr("y",-400/2).attr("class","pieTitleText"),_=[...h.entries()].map(([t,x])=>({label:t,value:x})),S=l.selectAll(".legend").data(_).enter().append("g").attr("class","legend").attr("transform",(t,x)=>{const z=o+p,V=z*_.length/2,Z=12*o,j=x*z-V;return"translate("+Z+","+j+")"});S.append("rect").attr("width",o).attr("height",o).style("fill",t=>v(t.label)).style("stroke",t=>v(t.label)),S.append("text").attr("x",o+p).attr("y",o-p).text(t=>r.getShowData()?`${t.label} [${t.value}]`:t.label);const N=Math.max(...S.selectAll("text").nodes().map(t=>t?.getBoundingClientRect().width??0)),U=d+A+o+p+N,R=I.node()?.getBoundingClientRect().width??0,X=d/2-R/2,q=d/2+R/2,W=Math.min(0,X),F=Math.max(U,q)-W;u.attr("viewBox",`${W} 0 ${F} ${c}`),se(u,c,F,T.useMaxWidth)},"draw"),Ae={draw:Te},Le={parser:Ce,db:M,renderer:Ae,styles:$e};export{Le as diagram};
