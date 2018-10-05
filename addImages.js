const name = 'svampeatlas';
const sourcePath = __dirname + `/sources/${name}/`;
const multimediaPath = sourcePath + 'multimedia.txt';
const _ = require('lodash');
const parse = require('csv-parse');
const transform = require('stream-transform');
const fs = require('fs');
const elasticsearch = require('elasticsearch');

var client = new elasticsearch.Client({
  host: 'localhost:9200'
});

// let options = {delimiter: '\t'};
let rs = fs.createReadStream(multimediaPath);
parser = parse({ delimiter: '\t', columns: true, relax: true, quote: false });

var idMap = {};
transformer = transform(function (row, next) {
  if (row.type !== 'StillImage') {
    next();
  } else {
    var o = {
      "gbifID": row.gbifID,
      "media_type": ['StillImage'],
      "image": row.identifier
    };
    addToIndex(o).then(function(){
        next();
    }).catch(function(err){
        console.log(err);
    });
  }

}, { parallel: 1 }, function (err, b) {
  console.log('error', err);
  console.log(b);
  console.log(Object.keys(idMap).length);
  Object.keys(idMap).forEach(function (e) {
    if (idMap[e] > 1) {
      console.log(e + ' ' + idMap[e]);
    }
  });
  doBulkIndex(bulk);
});

rs.pipe(parser).pipe(transformer);

var bulk = [];
async function addToIndex(row) {
  bulk.push(row);
  if (bulk.length < 12800) {
    // console.log('bulk below threshold', bulk.length);
    return;
  } else {
    try {
      for (var j = 0; j < bulk.length; j++) {
        var item = bulk[j];
        idMap[item.gbifID] = idMap[item.gbifID] ? idMap[item.gbifID] + 1 : 1;
      }
      var whatever = await doBulkIndex(bulk);
      bulk = [];
      return;
    } catch (err) {
      console.log('error', err);
    }

  }
}

function doBulkIndex(list) {

  return new Promise((resolve, reject) => {
    var actions = [];
    list.forEach(function (e) {
      actions.push({ update: { _index: name, _type: 'occurrence', _id: e.gbifID } });
      actions.push({ doc: e});
    });
    // console.log(actions);
    client.bulk({
      body: actions
    }, function (err, resp) {
      if (err) {
        console.log(err);
      }
      // for (var j = 0; j < resp.items.length; j++) {
      //     if (resp.items[j].index.status != 201) {
      //         console.log(resp.items[j]);
      //     }
      // }
      // setTimeout(function(){
      //     resolve();
      // }, 100);

      var backoff = false;
      if (resp && resp.errors) {
        //check for 429  - too many requests
        for (var j = 0; j < resp.items.length; j++) {
          if (resp.items[j].index.status == 429) {
            console.log('Too many requests - back off');
            backoff = true;
          }
        }
      }
      if (backoff) {
        setTimeout(function () {
          resolve();
        }, 1000);
      } else {
        resolve();
      }
    });
  });
}