
import jsonpath from 'jsonpath'

function pageClustering(siteAsJson, rendererModel,preview, ds, editorAPI) {
    const excludeTypes = ['GoogleAdSense'];
    let clusterIds = {}, errors = [], logs = [];
    function logErr() { errors.push(arguments) ; logs.push(arguments) }
    function logMessage() { logs.push(arguments) }

    const writeFile = editorAPI.wixCode.fileSystem.writeFile || ds.wixCode.fileSystem.writeFile;
    const flush = editorAPI.wixCode.fileSystem.flush || ds.wixCode.fileSystem.flush;
    function applyPath(obj,path) {
        const pathAr = path.split('$.').pop().split('#')[0].split('.');
        try {
            return pathAr.reduce((o,p)=>o[p],obj);
        } catch(e) {}
    }
    function compIdOfPage(page,path) {
        if (!page || !page.structure) debugger;
        const comp = applyPath(page.structure.components,path);
        return comp && comp.id;
    }
    function dataObjOfPage(page,path) {
        if (!page || !page.structure) debugger;
        const comp = applyPath(page.structure.components,path);
        return comp && comp.dataQuery && page.data.document_data[comp.dataQuery.slice(1)];
    }
    function nickNameOfPage(page,path) {
        if (!page || !page.structure) debugger;
        const comp = applyPath(page.structure.components,path);
        const res = comp && comp.connectionQuery && page.data.connections_data[comp.connectionQuery].items[0].role;
        if (!res) debugger;
        return res;
    }
    function translatePageRef(pageId) {
        const pageName = siteAsJson.pages.filter(pg=>pg.structure.id == pageId)[0].title.replace(/\W/g,'');
        const cluster = clusters.filter(cl=>cl.pages.filter(pg => pg.value.structure.id == pageId).length)[0];
        if (!cluster)
            return `/${pageName}`;
        return `/${cluster.id}/${pageName}`;
    }
    function calcId(candidate,ids) {
        if (!ids[candidate]) {
            ids[candidate] = true;
            return candidate;
        }
        var match = candidate.match(/(.*)([0-9]+)$/);
        if (!match)
            return calcId(candidate+'2',ids);
        else
            return calcId(match[1]+(Number(match[2])+1),ids);
    }

    const fileDesc = fn => ({ virtual: true, localTimeStamp: 0, eTag: "\"virtual\"", name: fn.split('/').pop(), length: 0, directory: false, location: fn, attributes: { readOnly: false } });

    const genericParams = ctx => ctx.protoDataObj.link ? [{ 
            id: 'link', 
            collectionType: 'url', 
            get: page => { 
                try {
                    const dataObj = dataObjOfPage(page,ctx.path);
                    const anchorLink = page.data.document_data[dataObj.link.slice(1)];
                    return translatePageRef(anchorLink.pageId.slice(1));
                } catch (e) {
                    console.log(dataObj,page,ctx,e);
                }
            }
        }] : [];

    const clusterDrivers = {
        StyledText: { short: 'Txt', params: ctx => ([
            { id: 'text', collectionType: 'richtext',
                get: page=> 
                    dataObjOfPage(page,ctx.path).text, 
                wixCodeSetter: 'html' 
            },
        ]) },
        LinkableButton: { short: 'Btn', params: ctx => [
                    { id: 'label', get: page => { 
                            const dataObj = dataObjOfPage(page,ctx.path).label;
                            return dataObj && dataObj.label;
                        }
                    },
                ]
        },
        Image: { short: 'Img', params: ctx => [
                    { id: 'image', collectionType: 'image', 
                        get: page => { 
                            const dataObj = dataObjOfPage(page,ctx.path);
                            return [dataObj.uri,dataObj.width,dataObj.height];
                        }
                    }]
        },
        ImageButton: { short: 'Btn', params: ctx => [
                    { id: 'image', collectionType: 'image', 
                        get: page => { 
                            const dataObj = dataObjOfPage(page,ctx.path);
                            const anchorLink = page.data.document_data[dataObj.link.slice(1)];
                            return siteAsJson.pages.filter(p=>p.structure.id == anchorLink.pageId.slice(1))[0].title;
                        }
                    },
                ]
        },
        TPAWidget: { 
            short(ctx) {
                return this.overrideBaseId(ctx)
            },
            overrideBaseId: ctx => {
                const appData = jsonpath.query(rendererModel,`$..*[?(@.applicationId=="${ctx.protoDataObj.applicationId}")]`)[0];
                return appData.appDefinitionName.replace(/\s/g,'');
            },
            params: ctx => {
                const appData = jsonpath.query(rendererModel,`$..*[?(@.applicationId=="${ctx.protoDataObj.applicationId}")]`)[0];
                const appName = appData.appDefinitionName.replace(/\s/g,'');
                const instance = appData.instance;

                const apps = {
                    WixProGallery: () => [ 
                        { id: 'this', collectionType: 'media-gallery',
                            get: page=> 
                                `https://progallery.wix.com/gallery.html?compId=${applyPath(page.structure.components,ctx.path).id}&instance=${instance}`
                        } 
                    ]
                }
                if (apps[appName])
                    return apps[appName]();
                else
                    return [];
            }
        },
    }
        
// calc pages props that are used for clustering. Namely, set of components paths+type
function clusteringProps(p,unSupportedComps) {
    const paths = jsonpath.apply(p.structure.components,'$..*.componentType',x=>x)
        .map(x=>x.path.join('.')+'#'+x.value);
    const s = new Set(paths), ar = Array.from(s);
    const hasUnsupportedComps =  ! ar.filter(path=>{
        const dataObj = dataObjOfPage(p,path);
        if (dataObj && !clusterDrivers[dataObj.type]) 
            unSupportedComps.add(dataObj.type);
        return dataObj && clusterDrivers[dataObj.type]
    })[0];
    return { ar, s, hasUnsupportedComps, comps: p.structure.components}
}

function clusterPages(pages) {
    let clusters = [];
    pages.forEach((page,i)=>{
        if (page.cluster) return;
        let cluster = clusterCalc.construct(page);
        clusters.push(cluster);
        pages.slice(i).forEach(toCompare=>{
            if (!toCompare.cluster && toCompare.ar.filter(x=>!page.s.has(x)).length == 0) {
                cluster.pages.push(toCompare);
                toCompare.cluster = cluster;
            }
        })
    })
    return clusters.filter(cl=>cl.pages.length > 1).sort((p1,p2)=>p2.pages.length-p1.pages.length);
}

// 'stateless class' for cluster. Used instead of a regular class in order to allow serlializing the clustering result as clean json
const clusterCalc = {
    construct(page) {
        let self = {};
        self.page = page;
        self.pageId = page.value.structure.id;
        self.pages = [page];
        self.title = page.value.title;
//        self.id = 'Like'+ page.value.title.replace(/\W/g,'');
        page.cluster = self;
        return self;
    },
    calcParams(self) {
        const protoPage = self.pages[0];
        const pathsOfObjs = protoPage.ar;
        let paramIds = {};
        self.notSupportedComps = self.notSupportedComps || {};
        self.paramObjs = pathsOfObjs
            .filter(path=>applyPath(protoPage.comps,path).dataQuery)
            .map(path=>{ 
                const comp = applyPath(protoPage.comps,path);
                const protoDataObj = dataObjOfPage(protoPage.value,path);
                let idPart = 'unknown';
                const driver = clusterDrivers[protoDataObj.type];
                if (!driver)
                    self.notSupportedComps[protoDataObj.type] = (self.notSupportedComps[protoDataObj.type] || 0)+1;
                else
                    idPart = typeof(driver.short) == 'function' ? driver.short({path,protoDataObj}) : driver.short;
 
                var pagesWithParam = self.pages.filter(page=>dataObjOfPage(page.value,path));
                var effectiveType = driver && driver.overrideBaseId ? driver.overrideBaseId({path,protoDataObj}) : protoDataObj.type;
                const id = calcId(effectiveType,paramIds);
                const layoutDomain = Array.from(new Set(pagesWithParam
                    .map(page=>applyPath(page.value.structure.components,path)).map(x=>x.layout)
                    .map(layout=> [layout.x,layout.width].join(','))));
                var params = genericParams({path,protoDataObj});
                if (typeof driver == 'object' && driver.params)
                    params = params.concat(driver.params({path,protoDataObj}));
                else if (!driver)
                    params = params.concat(Object.getOwnPropertyNames(protoDataObj).filter(p=>p!='id')
                        .map(p=>({ id: p, get: page => {
                            let ret = JSON.stringify(dataObjOfPage(page,path)[p]);
                            if (typeof ret == 'string' && ret.indexOf('#dataItem-') == 0)
                                ret = page.data.document_data[ret.slice(1)];
                            return ret;
                        }
                    })));
                // enrich params
                params = params.map(param=> Object.assign(param,{
                    id: (param.id == 'this') ? id  : (id+ '_' + param.id),
                    wixCodeSetter: param.wixCodeSetter || param.id,
                    domain: Array.from(new Set(pagesWithParam.map(page=>{ 
                        try {
                            if (dataObjOfPage(page.value,path))
                                return param.get(page.value)
                        } catch (e) {}
                    }).filter(x=>x)))
                }))
                .filter(param=>param.domain.length > 1);
    
                return {id, idPart, layoutDomain, effectiveType, path, protoDataObj, params, pagesWithParam: pagesWithParam.length,         dataId: protoDataObj.id }
            })
            .filter(paramObj=>excludeTypes.indexOf(paramObj.effectiveType) == -1)
            .filter(paramObj=>paramObj.params && paramObj.params.length);

        self.id = calcId(self.paramObjs.slice(0,5).map(x=>x.idPart).join('').replace(/Wix/g,''),clusterIds);
    },
    calcDB(self) {
        self.db = {};
        self.rows = self.pages.map(page=>{
            let pageVals = { title: page.title};
            self.paramObjs.forEach(paramObj=>paramObj.params.forEach(param=>{
                let val = '';
                try {
                    val = param.get(page.value);
                } catch (e) {}
                pageVals[param.id] = val;
            }
            ));
            self.db[page.title.replace(/\W/g,'')] = pageVals;
            return pageVals;
        })
        const firstRecord = self.db[Object.getOwnPropertyNames(self.db)[0]];
        self.dbAsStr = `export const ${self.id} = ` + JSON.stringify(self.db,null,2);
        let fields = {};
        self.paramObjs.forEach(paramObj=>paramObj.params.forEach(param=>
            fields[param.id] = { displayName: param.id, type: param.collectionType || 'text'}));
        self.collectionDef= { id: self.id, displayName: self.id, displayField: 'title', fields }
        
    },
    enrichDBValues(self) {
        const noOfGalleryProps = self.paramObjs.filter(x=>x.id === 'WixProGallery').length;
        logMessage('enrich gallery: fetching ' + (noOfGalleryProps * self.pages.length) + ' galleries for cluster ' + self.id 
            + ' ' + clusters.findIndex(x=>x.id === self.id) +'/' + clusters.length) ;
        return self.rows.reduce((pr,row) =>
            pr.then(() => enrichRowWithGalleries(row)), Promise.resolve())
          .then(()=>logMessage('end enrich for cluster ' + self.id))
    },
    // addRouter(self) {
    //     const routerPtr = ds.routers.add(
    //         Object.assign({},_.find(preview.rendered.props.siteData.rendererModel.clientSpecMap.toJS()),{ 
    //             appDefinitionId: "wix-code", 
    //             prefix: self.id, 
    //             config: { routerFunctionName: `${self.id}_Router`, siteMapFunctionName: `${self.id}_SiteMap` } 
    //         }));
    //     ds.routers.pages.connect(routerPtr, {type: "DESKTOP", id: self.pageId }, self.pageId);
    // },
    addControllerToPage(self) {
        const controlller = {
            type: "Component", layout: {width: 60,height: 78,x: 450,y: 70}, componentType: "platform.components.AppController",
            data: {
                type: "AppController",
                name: self.id + " item", controllerType: "router_dataset", applicationId: "dataBinding",
                },
            style: "controller1",
            connections: { type: "ConnectionList", items: [{type: "WixCodeConnectionItem","role": "dynamicDataset" }]},
        };
        self.pageControllerRef = ds.components.add({type: "DESKTOP", id: self.pageId }, controlller)
//            settings: `{"dataset":{"collectionName":"${self.id}","readWriteType":"READ","filter":null,"sort":null,"includes":null,"pageSize":20}}`,
    },
    addDynamicPageRouter(self) {
        self.dynamicPageRouter = ds.routers.add(
            Object.assign({},_.find(preview.rendered.props.siteData.rendererModel.clientSpecMap.toJS()),{ 
                appDefinitionId: "dataBinding", 
                prefix: self.id, 
                config: { patterns: {
                    "/{title}": {
                    pageRole: self.pageId,
                    title: "{title}",
                    config: { collection: self.id },
                    seoMetaTags: {}
                    }
                } }
        }));
        ds.routers.pages.connect(self.dynamicPageRouter, {type: "DESKTOP", id: self.pageId }, [self.pageId])
    },
    connectParams(self) {
        self.paramObjs.forEach(paramObj=>{
            paramObj.params.forEach(param=> {
                try {
                    ds.platform.controllers.connections.connect(
                        { type: "DESKTOP", id: compIdOfPage(self.page.value,paramObj.path) },
                        self.pageControllerRef,
                        'textRole', // ??
                        { properties: { label: { fieldName: param.id }, $text: { fieldName: param.id }  }}
                    )
                } catch(e) {
                    console.log(`can not set connection to ${self.id}::${param.id}`)
                }
          })
        })
    },
    injectCollection(self) {
        return writeFile(fileDesc(`.schemas/${self.id}.json`), JSON.stringify(self.collectionDef))
            .then(() => flush())
            .then(() => clusterCalc.bulkInsertToCollection(self));
    },
    injectDataBinding(self) {
        this.addControllerToPage(self);
        this.addDynamicPageRouter(self);
        return new Promise(resolve=>{
            setTimeout(()=>{ 
                this.connectParams(self) 
                resolve() 
            },1000); // why delay??
        })
    },
    bulkInsertToCollection(self) {
        const instance = _.find(rendererModel.clientSpecMap,x=>x.type == 'siteextension').instance;
        return Promise.resolve(this.enrichDBValues(self)).then(() => {
            const bulkSize = 10;
            const bulks = Array.from(new Array(Math.floor(self.rows.length/bulkSize)+1).keys()).map(i=>
                [self.id,self.rows.slice(i*bulkSize, (i+1)*bulkSize),{}]);
            logMessage('bulk insert', self.rows, bulks);
            return bulks.reduce((promise,bulk)=>promise.then(()=>doBulkInsert(bulk)), Promise.resolve())
       });

       function doBulkInsert(bulkInsertParams) {
            console.log('bulk', bulkInsertParams);
            const info = ds.wixCode.fileSystem.getViewerInfo();
            return fetch(
            `https://code-dev.apps.wix.com/api/wix/data-web.jsw/bulkInsert.ajax?viewMode=preview&instance=${instance}&scari=${info.scari}&gridAppId=${info.gridAppId}`,
            {
            "method":"POST", "mode":"cors",
            "headers":{ "Content-type": "application/json" },
            "referrer":"https://static.parastorage.com/services/cm-editor-app/1.386.0/import-panel.cdn.html?applicationId=9177",
            "referrerPolicy":"no-referrer-when-downgrade",
            "body": JSON.stringify(bulkInsertParams),
            "credentials": "include"
            }
        ).then(res=>{
            if (!res.ok) 
                return logErr('error in bulk insert', res)
        }).catch(e=>logErr(e))}
    },        
    wixCode(self) {
        return `import wixWindow from 'wix-window';\n\n$w.onReady(function () { \n const data = wixWindow.getRouterData();\n`+
            self.paramObjs.map(paramObj=>{
                const nickName = nickNameOfPage(self.page.value,paramObj.path);
                return paramObj.params.map(param=> 
                    `  $w('#${nickName}').${param.wixCodeSetter} = data.${param.id};\n`)
                    .join('')
        }).join('') + '\n});'
    }
           //writeFile(`public/pages/${cl.pages[0].value.structure.id}.js`,cl.wixCode)
}
let clusters = [];

return {
    clusterCalc, errors, logs,
    run() {
        this.calcClusters();
        this.injectCollections()
            .then(()=> this.injectDataBinding())
            .then(()=>this.removeRedundentPages())
            .then(()=> {
                const finishMsg = this.errors.length ? `finished with ${this.errors.length} errors` : 'success';
                logMessage(finishMsg);
                console.log(finishMsg, this.errors)
            })
    },
    // runWixCode() {
    //     this.calcClusters();
    //     this.removeRedundentPages();
    //     this.injectDB();
    //     this.injectRouters();
    //     this.injectWixCode();
    // },
    calcClusters() {
        let unSupportedComps = new Set();
        debugger
        const pages = siteAsJson.pages.map((page,i)=> 
            Object.assign({value: page, index:i , title: page.title }, clusteringProps(page,unSupportedComps)))
            .sort((p1,p2)=>p2.ar.length - p1.ar.length);
        const notToCluster = pages.filter(p=>p.hasUnsupportedComps);
        // console.log(notToCluster.length + ' of ' + pages.length + ' pages can not be clustered because of unsupported components: ' + Array.from(unSupportedComps).join(','));
        const pagesToCluster = pages; //.filter(p=>!p.hasUnsupportedComps);
                    
        clusters = clusterPages(pagesToCluster); // clusters must be global. It is used by translatePageRef()
        clusters.forEach(cl=> { 
            clusterCalc.calcParams(cl);
            clusterCalc.calcDB(cl); 
        });
        this.clusters = clusters;
        return clusters;
    },
    // injectDB() {
    //     clusters.forEach(cl=>writeFile(fileDesc(`backend/${cl.id}_db.js`),cl.dbAsStr));
    //     const routersFile = fileDesc('backend/routers.js');
    //     let content = 'import {ok, notFound, WixRouterSitemapEntry} from "wix-router";\n' + 
    //         clusters.map(cl=> routerFileContent.replace(/PAGE_ID/g,cl.id).replace(/PAGE_TITLE/g,cl.title)).join('\n');
    //     writeFile(routersFile, content);
    //     //clusters.forEach(cl=>clusterCalc.addRouter(cl) );
    // },
    injectCollections() {
        return clusters.reduce((pr,cl) =>
            pr.then(() => clusterCalc.injectCollection(cl)), Promise.resolve())
    },
    injectDataBinding() {
        return clusters.reduce((pr,cl) =>
            pr.then(() => clusterCalc.injectDataBinding(cl)), Promise.resolve())
    },
    notSupportedComps() {
        let result = {};
        clusters.forEach(cl=>Object.getOwnPropertyNames(cl.notSupportedComps)
            .forEach(p=> result[p] = (result[p] || 0)+(cl.notSupportedComps[p] || 0) ) );
        return Object.getOwnPropertyNames(result).map(p=>`${p} - ${result[p]}`);
    },

    // injectRouters() {
    //     clusters.forEach(cl=>clusterCalc.addRouter(cl) );
    // },
    // injectWixCode() {
    //     clusters.forEach(cl=>writeFile(fileDesc(`public/pages/${cl.pageId}.js`), clusterCalc.wixCode(cl)) );
    // },
    removeRedundentPages() {
        clusters.forEach(cl=>cl.pages.slice(1).forEach(page=> {
                logMessage('removing page ' + page.value.title)
                ds.pages.remove(page.value.structure.id,_=>logMessage(page.value.title + ' page removed')) 
            } ));
     },
    _keepTwoPages() {
        clusters.forEach(cl=>cl.pages.forEach(page=> {
                console.log('removing page ' + page.value.title);
                if (page.value.title != 'Home' && page != clusters[0].pages[0] && page != clusters[0].pages[1])
                    ds.pages.remove(page.value.structure.id,_=>console.log(page.value.title + ' page removed')) 
            } ));
     },

    _removeMostOfTheRecurringPages() {
        clusters.forEach(cl=>cl.pages.slice(5).forEach(page=> {
                console.log('removing page ' + page.value.title);
                ds.pages.remove(page.value.structure.id,_=>console.log(page.value.title + ' page removed')) 
            } ));
     },
    statistics() {
        //console.log(clusters);
        let out = clusters.map(cl=>`${cl.pages.length}: ${cl.pages[0].ar.length}-${cl.pages.slice(-1)[0].ar.length}`);
        const pageCoverage = clusters.reduce((sum,cl)=>cl.pages.length+sum,0);
        out += '\nCoverage: ' + pageCoverage + ' of ' + siteAsJson.pages.length;
        return out;
    }
  }
 
  function enrichRowWithGalleries(row) {
        const slugify = text => 
            text.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
        const formatMediaUrlToSrc = (mediaUrl, meta) =>
            'wix:image://v1/' + (mediaUrl || slugify(meta.name)) + '/' + slugify(meta.fileName) + '#originWidth=' + meta.width + '&originHeight=' + meta.height;

        return Object.getOwnPropertyNames(row)
            .filter(prop=>/^WixProGallery/.test(prop))
            .reduce((pr, prop) =>
            pr.then(() => {
                if (/^http/.test(row[prop]))
                return fetch(row[prop])
                    .then(res=>{
                        if (!res.ok) 
                            return logErr('error in enrichRowWithGalleries', row, res);
                        return res.text().then(html=>{
                            if ((''+html).indexOf('ng-app="wixErrorPagesApp"') != -1) 
                                return logErr('wixErrorPagesApp', row, res);
                            let txt = html.substring(html.indexOf('window.prerenderedGallery ='));
                            txt = txt.substring(txt.indexOf('({"items"'));
                            txt = txt.substring(0,txt.indexOf('try {')).trim().slice(0,-1);
                            const gallery = eval(txt);
                            row[prop] = gallery.items.map(item=>proGalleryItemToWixCode(item));
                        })
                    }).catch(e=>logErr(e))
            }), Promise.resolve())

        function proGalleryItemToWixCode(item) {
            const metaStr = item.metaData || item.metadata || '{}';
            const meta = JSON.parse(metaStr.replace(/\\"/g,'"'));
            const type = meta.type || 'image';
            const res = { type, link: item.url, target: item.target, slug: item.itemId, title: meta.title, description: meta.description }
            if (type === 'text') {
            const style = meta.testStyle || {};
            Object.assign(res, {
                html: meta.html,
                style: { width: style.width, height: style.height, bgColor: style.backgroundColor }
            });
            } else if (type === 'image') {
                Object.assign(res, {
                src: formatMediaUrlToSrc(item.mediaUrl, meta),
                settings: { focalPoint: meta.focalPoint }
                });
            } else if (type === 'video') {
                Object.assign(res, { src: item.mediaUrl, thumbnail: item.mediaUrl });
            }
            return res;
        }
    }  
}

export default pageClustering