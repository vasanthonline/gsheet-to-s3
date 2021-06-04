// add a menu to the toolbar when the add-on is installed or opened
const createMenu = () => {
  SpreadsheetApp.getUi()
  .createMenu('Publish to S3')
  .addItem('Configure...', 'showConfig')
  .addToUi();
};
const onInstall = createMenu;
const onOpen = createMenu;
  
// checks if document has the required configuration settings to publish to S3
// Note: does not check if the config is valid
const hasRequiredProps = () => {
  const props = PropertiesService.getDocumentProperties().getProperties();
  const { bucketName, awsAccessKeyId, awsSecretKey, awsRegion } = props
  return (bucketName && bucketName.length &&
          awsAccessKeyId && awsAccessKeyId.length &&
          awsSecretKey && awsSecretKey.length &&
          awsRegion && awsRegion.length
  );
};

// publish updated JSON to S3 if changes were made to the first sheet
const publish = () => {
  const sheet = SpreadsheetApp.getActiveSpreadsheet();
  // do nothing if required configuration settings are not present, or
  // if the edited sheet is not the first one (sheets are indexed from 1,
  // not 0)
  if (!hasRequiredProps() || sheet.getActiveSheet().getIndex() > 1) {
    return;
  }

  const csvContents = convertRangeToCsvFile(sheet);

  // upload to S3
  // https://engetc.com/projects/amazon-s3-api-binding-for-google-apps-script/
  const props = PropertiesService.getDocumentProperties().getProperties();
  const s3 = getInstance(props.awsAccessKeyId, props.awsSecretKey, props.awsRegion);
  s3.putObject(props.bucketName, [props.path, sheet.getId()].join('/'), csvContents);
};

// show the configuration modal dialog UI
const showConfig = () => {
  const sheet = SpreadsheetApp.getActiveSpreadsheet(),
    props = PropertiesService.getDocumentProperties().getProperties(),
    template = HtmlService.createTemplateFromFile('config');
  template.sheetId = sheet.getId();
  // default to empty strings, otherwise the string "undefined" will be shown
  // for the value
  const templateProps = Object.entries(props)
  .reduce((acc, [key, val]) => Object.assign(acc, { [key]: val || '' }), {});
  Object.assign(template, templateProps);
  SpreadsheetApp.getUi()
  .showModalDialog(template.evaluate(), 'Amazon S3 publish configuration');
}

// update document configuration with values from the modal
const updateConfig = form => {
  const sheet = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getDocumentProperties().setProperties({
    bucketName: form.bucketName,
    path: form.path,
    awsAccessKeyId: form.awsAccessKeyId,
    awsSecretKey: form.awsSecretKey,
    awsRegion: form.awsRegion
  });
  let title, message;
  if (hasRequiredProps()) {
    try {
      publish();
      title = '✓ Configuration updated';
      message = `Published spreadsheet will be accessible at:\nhttps://${form.bucketName}.s3.amazonaws.com/${form.path}/${sheet.getId()}`;
    }
    catch (ex) {
      title = '⚠ Error publishing to S3';
      message = `Sorry, there was an error publishing your spreadsheet:\n${ex}`;
    }
    // If the publish trigger doesn't already exist, create it programatically instead
    // of manually because manual triggers disappear for no reason. See:
    // https://code.google.com/p/google-apps-script-issues/issues/detail?id=4854
    // https://code.google.com/p/google-apps-script-issues/issues/detail?id=5831
    if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'publish')) {
      ScriptApp.newTrigger('publish')
      .forSpreadsheet(SpreadsheetApp.getActive())
      .onChange()
      .create();
    }
  }
  else {
    title = '⚠ Required info missing';
    message = 'You need to fill out all fields for your spreadsheet to be published to S3.';
  }
  const ui = SpreadsheetApp.getUi();
  ui.alert(title, message, ui.ButtonSet.OK);
}

const convertRangeToCsvFile = (sheet) => {
  // get available data range in the spreadsheet
  var activeRange = sheet.getDataRange();
  try {
    var data = activeRange.getValues();
    var csvFile = undefined;

    // loop through the data in the range and build a string with the csv data
    if (data.length > 1) {
      var csv = "";
      for (var row = 0; row < data.length; row++) {
        for (var col = 0; col < data[row].length; col++) {
          if (data[row][col].toString().indexOf(",") != -1) {
            data[row][col] = "\"" + data[row][col] + "\"";
          }
        }

        // join each row's columns
        // add a carriage return to end of each row, except for the last one
        if (row < data.length-1) {
          csv += data[row].join(",") + "\r\n";
        }
        else {
          csv += data[row];
        }
      }
      csvFile = csv;
    }
    return csvFile;
  }
  catch(err) {
    Logger.log(err);
    Browser.msgBox(err);
  }
}