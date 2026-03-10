const XLSX = require('xlsx');
try {
    const wb = XLSX.readFile('inventario_ml.xlsx');
    const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    console.log(JSON.stringify(data, null, 2));
} catch (e) {
    console.error(e);
}