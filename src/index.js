import pageClustering from './cluster'
import download from './download'
import fs from 'fs'
import {Parser} from 'json2csv'
import _  from 'lodash'

function clusterToSpreadsheet(siteName, siteData) {
    const pages = siteData.pages.filter(pg=>pg.structure.id != 'masterPage');
    const masterPage = siteData.pages.filter(p=>p.structure.id == 'masterPage')[0];

    const editorAPI = {wixCode: { fileSystem: { writeFile: () => {}, flush: () => {} }}}
    const clustering = pageClustering({pages},siteData.rendererModel,{},{},editorAPI);
    const clusters = clustering.calcClusters();
    const dir = getProcessArgument('result') || `${siteName}-clusters`.replace(/[^a-zA-Z0-9]/g,'');
    try {
      fs.mkdirSync(dir)
    } catch(e) {}
    clusters.forEach(cl=>{
      fs.writeFileSync(`${dir}/${cl.id}.csv`,clusterToCsv(cl))
      fs.writeFileSync(`${dir}/${cl.id}-def.json`,JSON.stringify(cl.collectionDef,null,2))
    });
    fs.writeFileSync(`${dir}/statistics.txt`,clustering.statistics())
}

function clusterToCsv(cluster) {
    const fieldsToFix = Object.keys(cluster.collectionDef.fields).filter(f=>/StyledText[0-9]*_text/.test(f));
    const fixedFields = _.flatMap(Object.keys(cluster.collectionDef.fields),f =>{
      if (/StyledText[0-9]*_text/.test(f))
        return [f.replace(/_text/,''), f.replace(/_text/,'_html')]
      return [f];
    })
    const sortedFields = [...fixedFields.filter(f => f.indexOf('_html') == -1),...fixedFields.filter(f => f.indexOf('_html') != -1)]
    cluster.rows.forEach(r=>fixTextFields(r, fieldsToFix))
    return new Parser({ fields: ['title', ...sortedFields] })
      .parse(cluster.rows)
}

function fixTextFields(row, fieldsToFix) {
  fieldsToFix.forEach(fld =>{
    row[fld.replace(/_text/,'_html')] = row[fld];
    row[fld.replace(/_text/,'')] = (row[fld].match(/>([^<]+)/)||['',''])[1];
    delete row[fld]
  })
}

function run() {
    const siteName = getProcessArgument('site') || 'shaiby4.wixsite.com/samples';
    return download(siteName)
        .then(siteData => {
            console.log(siteData)
            clusterToSpreadsheet(siteName, siteData)
        })
        .catch(e=>console.log(e))
}
run()


function getProcessArgument(argName) {
    for (var i = 0; i < process.argv.length; i++) {
      var arg = process.argv[i];
      if (arg.indexOf('-' + argName + ':') == 0) 
        return arg.substring(arg.indexOf(':') + 1).replace(/'/g,'');  // replacing ' to prevent sql injection;
      if (arg == '-' + argName) return true;
    }
    return '';
}
