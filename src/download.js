import fs from 'fs'
import { Observable, from } from 'rxjs';
import { map, filter, take, toArray, concatMap, tap } from 'rxjs/operators';
import fetch from 'node-fetch';

const sites_data = `shaiby4.wixsite.com/samples`;

let rendererModel = {}
function downloadSitePages(url) {
    const fetchUserSite = fetch(`http://${url}`)
        .then(x=>x.text()).then(x=>''+x)
        .catch(err=> { console.log(url, err); return [] })

    const parseSiteData = html =>{
        const rendererModelExp = html.match(/(rendererModel =.*)/)[1].trim().slice(0, -1)
        eval(rendererModelExp);
        return rendererModel
    };

    const pagesOfSite = rendererModel =>
        [{title: 'masterPage', pageJsonFileName: rendererModel.pageList.masterPageJsonFileName}
            ,...rendererModel.pageList.pages].filter(x=>x.pageJsonFileName)
//            .slice(0,300)
            .map(({pageJsonFileName, pageUriSEO, title}) => ({title, pageId: pageJsonFileName.split('.')[0], metaSiteId: rendererModel.metaSiteId, siteId: rendererModel.siteInfo.siteId, pageUriSEO}))

    const loadPage = ({siteId, metaSiteId, pageId, title, pageUriSEO}) => {
        const url = `http://siteassets.parastorage.com/pages/fixedData?ck=1&isHttps=false&isUrlMigrated=true&metaSiteId=${metaSiteId}&quickActionsMenuEnabled=true&siteId=${siteId}&v=3&version=1.414.0&pageId=${pageId}`
        console.log(url)
        return fetch(url)
            .then(x=>x.text())
            .then(x=>Object.assign(JSON.parse(''+x),{title, pageUriSEO}))
            .catch(err=> { console.log(url, err); return [] })
    }

    return from(fetchUserSite).pipe(
        map(parseSiteData),
        concatMap(pagesOfSite),
        tap(x=>console.log(x)),
        concatMap(loadPage),
        toArray(),
    ).toPromise().then(pages=>({pages, rendererModel}))
    .catch(x=>console.log(x));
}

export default downloadSitePages
