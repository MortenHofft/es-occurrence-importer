const name = 'fungi';
const indexName = 'fungi';
const sourcePath = __dirname + `/sources/${name}/`;
const occurrencePath = sourcePath + 'occurrence.txt';
const _ = require('lodash');
const datasetTitles = require(sourcePath + 'dataset/datasteTitles');
const parse = require('csv-parse');
const transform = require('stream-transform');
const fs = require('fs');
const elasticsearch = require('elasticsearch');

let bulkSize = 100; //used to be 12800

var client = new elasticsearch.Client({
    host: 'localhost:9200'
    // host: 'es1.gbif-dev.org:9200'
});

var clientLookup = new elasticsearch.Client({
    host: 'localhost:9200'
});

// let options = {delimiter: '\t'};
let rs = fs.createReadStream(occurrencePath);
parser = parse({ delimiter: '\t', columns: true, relax: true, quote: false });

var counter = 0;
var maxCount = 100000000;
var idMap = {};
let ranks = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species'];
transformer = transform(function (row, next) {
    if (counter > maxCount) {
        next();
        return;
    }
    parseRow(row, next);
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

async function parseRow(row, next) {
    // work with row

    // idMap[row.gbifid] = idMap[row.gbifid] ? idMap[row.gbifid]+1 : 1;
    // call next when finished
    Object.keys(row).forEach(function (key) {
        if (row[key] === '') {
            delete row[key];
        }
    });
    row.location = {
        lat: row.decimalLatitude,
        lon: row.decimalLongitude
    };

    let backbone = [];
    ranks.forEach(function (rank) {
        if (row[rank]) {
            row[rank + 'Key'] = _.toSafeInteger(row[rank + 'Key'])
            backbone.push({
                taxonKey: row[rank + 'Key'],
                name: row[rank]
            });
        }
    });

    backboneMap = {};
    backbone.forEach(function (e, i) {
        e['depthKey_' + i] = e.taxonKey;
        // e.depth = i;
        e.rank = ranks[i].toUpperCase();
        e[ranks[i] + 'Key'] = e.taxonKey;
        backboneMap[i] = e;
    });
    row.taxonKeys = _.filter([row.kingdomKey, row.phylumKey, row.classKey, row.orderKey, row.familyKey, row.genusKey, row.speciesKey], _.identity);

    let issue = row.issue && row.issue.length > 0 ? row.issue.split(';') : undefined;
    var o = {
        "gbifID": row.gbifID,
        "scientificName": row.scientificName,
        /*"kingdom": row.kingdom,
        "kingdomKey": row.kingdomKey,
        "phylum": row.phylum,
        "phylumKey": row.phylumKey,
        "class": row.class,
        "classKey": row.classKey,
        "order": row.order,
        "orderKey": row.orderKey,
        "family": row.family,
        "familyKey": row.familyKey,
        "genus": row.genus,
        "genusKey": row.genusKey,
        "species": row.species,
        "speciesKey": row.speciesKey,*/
        "taxonKey": _.toSafeInteger(row.taxonKey),
        "rank": row.taxonRank,
        // "taxonKeys": row.taxonKeys,
        "backbone": backbone,
        // "backboneMap": backboneMap,
        "issue": issue,
        "datasetKey": row.datasetKey,
        "datasetTitle": datasetTitles[row.datasetKey] || 'Unknown',
        "countryCode": row.countryCode,
        "month": _.toSafeInteger(row.month),
        "recordedBy": row.recordedBy,
        "hasCoordinate": row.hasCoordinate,
        "decimalLatitude": row.decimalLatitude,
        "decimalLongitude": row.decimalLongitude,
        "coordinate_point": row.decimalLatitude && row.decimalLongitude ? row.location : undefined,
        "elevation": row.elevation,
        "eventDate": row.eventDate,
        "locality": row.locality,
        "basisOfRecord": row.basisOfRecord,
        "institutionCode": row.institutionCode,
        "occurrenceRemarks": row.occurrenceRemarks,
        "municipality": row.municipality,
        "locality": row.locality,
        "catalogNumber": row.catalogNumber,
        "year": _.toSafeInteger(row.year),
        "organismID": row.organismID
    };
    if (row.dynamicProperties) {
        try {
            let dynProp = JSON.parse(row.dynamicProperties);
            o.dynamicProperties = dynProp;
        } catch (err) {
            o.dynamicProperties = row.dynamicProperties;
        }
    }
    // console.log(o);
    // next();

    if (!_.isUndefined(row.decimalLatitude) && !_.isUndefined(row.decimalLongitude)) {
        let locationInfo = await getLocationInfo(row.decimalLatitude, row.decimalLongitude);
        //let locationInfo = await getLocationInfo(55.7,12.5);
        o.gadm = {
            "GID_0": locationInfo.GID_0,
            "GID_1": locationInfo.GID_1,
            "GID_2": locationInfo.GID_2
        };
    }

    addToIndex(o).then(function () {
        counter++;
        if (counter % 1000 === 0) {
            console.log(counter);
        }
        next();
    }).catch(function (err) {
        console.log(err);
    });
}

rs.pipe(parser).pipe(transformer);

var bulk = [];
async function addToIndex(row) {
    bulk.push(row);
    if (bulk.length < bulkSize && bulk.length < maxCount) {
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
            actions.push({ index: { _index: indexName, _type: 'occurrence', _id: e.gbifID } });
            actions.push(e);
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
                    // if (resp.items[j].index.status == 429) {
                    if (resp.items[j].index.status > 404) {
                        console.log('Back off');
                        backoff = true;
                    }
                }
            }
            if (backoff) {
                setTimeout(function () {
                    resolve();
                }, 120000);
            } else {
                resolve();
            }
        });
    });
}

async function getLocationInfo(lat, lng){
    let response = await clientLookup.search({
        index: 'geolookup',
        type: 'shape',
        body: {
            "_source": "properties",
            "query": {
                "bool": {
                    "must": {
                        "match_all": {}
                    },
                    "filter": {
                        "geo_shape": {
                            "geometry": {
                                "shape": {
                                    "type": "point",
                                    "coordinates": [lng, lat]
                                },
                                "relation": "CONTAINS"
                            }
                        }
                    }
                }
            }
        }
    });

    var hits = _.get(response, 'hits.hits[0]._source.properties', {});
    return hits;
}
