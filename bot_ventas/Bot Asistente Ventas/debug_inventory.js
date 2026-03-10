const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const EXCEL_FILE = 'inventario_ml.xlsx';

function getInventory() {
    console.log("Reading file:", EXCEL_FILE);
    if (!fs.existsSync(EXCEL_FILE)) {
        console.error(`[ERROR] No se encontró el archivo de inventario: ${EXCEL_FILE}`);
        return [];
    }

    try {
        const workbook = xlsx.readFile(EXCEL_FILE);
        const sheetName = workbook.SheetNames[0];
        console.log("Sheet Name:", sheetName);
        const worksheet = workbook.Sheets[sheetName];
        
        // Convertir a JSON
        const data = xlsx.utils.sheet_to_json(worksheet);
        console.log("Raw Data Length:", data.length);
        if (data.length > 0) {
            console.log("First row keys:", Object.keys(data[0]));
            console.log("First row:", data[0]);
        }
        
        // Procesar datos con "relleno" (fill down) de Categoría y Tipo
        const processedData = [];
        let lastCategory = "General";
        let lastType = "";

        data.forEach((row, index) => {
            // Actualizar referencias si la fila tiene datos, si no, usar anterior
            if (row.Categoria) lastCategory = row.Categoria;
            if (row.Tipo) lastType = row.Tipo;

            // Si la fila no tiene producto, saltarla (puede ser fila vacía o solo encabezado de categoría)
            if (!row.Producto && !row.producto) {
                // console.log(`Row ${index} skipped (no product)`);
                return;
            }

            processedData.push({
                producto: row.Producto || row.producto || "",
                stock: row.Stock_Actual || row.stock_actual || 0,
                precio: row.Precio || row.precio || 0,
                lote: row.Lote_Inicial || row.lote_inicial || 0,
                categoria: lastCategory,
                tipo: row.Tipo || lastType || "",
                medida: row.Medida || row.medida || ""
            });
        });

        console.log("Processed Data Length:", processedData.length);
        if (processedData.length > 0) {
            console.log("First processed item:", processedData[0]);
        }
        return processedData;

    } catch (error) {
        console.error("[ERROR] Error leyendo el archivo Excel:", error);
        return [];
    }
}

try {
    getInventory();
} catch (e) {
    console.error("Global Error:", e);
}
