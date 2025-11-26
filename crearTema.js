const fs = require('fs');
const path = require('path');

const DIRTY_DIR = './dirtytest';
const OUTPUT_DIR = './temas_limpios';
const LIMITE = 50; // 🔥 cantidad máxima de preguntas por archivo

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR);
}

function dividirArray(array, size) {
    const partes = [];
    for (let i = 0; i < array.length; i += size) {
        partes.push(array.slice(i, i + size));
    }
    return partes;
}

function convertirArchivo(nombreArchivo, indice) {
    const ruta = path.join(DIRTY_DIR, nombreArchivo);
    const data = JSON.parse(fs.readFileSync(ruta, 'utf8'));

    const partes = dividirArray(data, LIMITE); // 🧠 dividir en bloques

    partes.forEach((preguntasBloque, parteIndex) => {
        const nuevoFormato = {
            tema: `TEMA-${indice}`,
            fecha: new Date().toISOString(),
            feedback: "",
            preguntas: preguntasBloque
        };

        const salida = path.join(OUTPUT_DIR, `tema_${indice}_parte_${parteIndex + 1}.json`);
        fs.writeFileSync(salida, JSON.stringify(nuevoFormato, null, 2));
        console.log(`✔️ Generado: ${salida}`);
    });
}

function procesarArchivos() {
    const archivos = fs.readdirSync(DIRTY_DIR).filter(f => f.endsWith('.json'));

    archivos.forEach((archivo, i) => {
        convertirArchivo(archivo, i + 1);
    });

    console.log('✨ Conversión completa con división en bloques de 50 preguntas.');
}

procesarArchivos();
