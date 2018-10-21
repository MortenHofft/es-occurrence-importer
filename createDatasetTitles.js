const name = 'organism24';
const sourcePath = __dirname + `/sources/${name}/dataset/`;

const fs = require('fs');
const path = require('path');
const xml2js = require('xml2js');

let titles = {};

async function getFiles() {
  fs.readdir(sourcePath, function (err, files) {
    if (err) {
      console.error("Could not list the directory.", err);
      process.exit(1);
    }

    readFiles(files);
  });
}

async function readFiles(files) {
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    var filePath = path.join(sourcePath, file);
    await readFile(filePath);
  };
  writeFile(titles);
}

function writeFile(content){
  fs.writeFile(sourcePath + 'datasteTitles.json', JSON.stringify(content, null, 2), function(err) {
    if(err) {
        return console.log(err);
    }
    console.log("The file was saved!");
}); 
}

function readFile(file) {
  const content = fs.readFileSync(file, 'utf8');
  let parser = new xml2js.Parser();
  var promise = new Promise(function (resolve, reject) {
    parser.parseString(content, function (err, result) {
      if (err) {
        console.log(err);
        reject(err);
        return;
      }
      let title = result['eml:eml']['dataset'][0].title[0];
      let key = result['eml:eml']['$']['packageId'];
      titles[key] = title;
      resolve({ title: title, key: key });
    });
  });
  return promise;
}

getFiles();