import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'

const outDir = path.resolve('public/templates')
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true })
}

const quintaRows = [
  ['FUNÇÕES', '7-mai.', '14-mai.', '21-mai.', '28-mai.', '4-jun.', '11-jun.', '18-jun.', '25-jun.', '2-jul.', '9-jul.', '16-jul.', '23-jul.', '30-jul.'],
  ['MINISTRO 01', 'Juliano Dias', 'Jossi', 'Juliano Dias', 'John', 'Jossi', 'Analice', 'John', 'Jossi', 'Analice', 'Juliano', 'Jossi', 'Analice', 'John'],
  ['MINISTRO 02', 'Shirlei', 'Mislane', 'Shirlei', 'Ana Alice', 'Juliano', 'Shirlei', 'Mislane', 'Shirlei', 'John', 'Shirlei', 'Mislane', 'Juliano', 'Shirlei'],
  ['VOCAL 01', 'Rodrigo', 'Ana Alice', 'Rodrigo', 'Geovani', 'Tafarel', 'Rodrigo', 'Juliano', 'Juliano', 'Tafarel', 'Geovani', 'Allan', 'Geovani', 'Rodrigo'],
  ['VOCAL 02', '', 'Allan', '', '', 'Rodrigo', 'Geovani', '', '', 'Rodrigo', '', '', '', ''],
  ['VIOLÃO', 'Juliano Dias', 'Ana Alice', 'Juliano Dias', 'John', 'Juliano', 'Rodrigo', 'John', 'Juliano', 'John', 'Juliano', 'Allan', 'Juliano', 'John'],
  ['TECLADO', 'Juninho', 'Allan', 'Juninho', 'Ana Alice', 'Juninho', 'Analice', 'Juninho', 'Analice', 'Analice', 'Juninho', 'Juninho', 'Analice', 'Juninho'],
  ['CONTRA BAIXO', 'Pedro', 'Vinicius', 'Pedro', 'Vinicius', 'Tafarel', 'Vinicius', 'Pedro/Diego', 'Vinicius', 'Tafarel', 'Vinicius', 'Tafarel', 'Pedro/Diego', 'Vinicius'],
  ['GUITARRA', 'Rodrigo', 'Geovani', 'Rodrigo', 'Geovani', 'Rodrigo', 'Geovani', 'Harley', 'Geovani', 'Rodrigo', 'Geovani', 'Harley', 'Geovani', 'Rodrigo'],
  ['BATERIA', 'Harley', 'Tafarel', 'Ivan', 'Allan', 'Ivan', 'Allan', 'Tafarel', 'Ivan', 'Allan', 'Harley', 'Ivan', 'Allan', 'Tafarel'],
]

const domingoRows = [
  ['ESCALA MINISTERIO LOUVOR - PALAVRA DA VIDA - DOMINGOS'],
  ['', '3-mai.', '10-mai.', '17-mai.', '24-mai.', '31-mai.', '7-jun.', '14-jun.', '21-jun.', '28-jun.', '5-jul.', '12-jul.', '19-jul.', '26-jul.'],
  ['FUNÇÕES', 'BANDA 01', 'BANDA 03', 'BANDA 02', 'BANDA 03', 'BANDA 01', 'EQUIPE', 'EQUIPE', 'EQUIPE', 'EQUIPE', 'BANDA 02', 'BANDA 01', 'BANDA3', 'BANDA 01'],
  ['MINISTRO 01', 'John', 'Juliano Dias', 'Jossi', 'Juliano Dias', 'John', 'Jossi', 'Juliano', 'John', 'Analice', 'Jossi', 'John', 'Shirlei', 'Camily'],
  ['MINISTRO 02', 'Camily', 'Shirlei', 'Mislane', 'Shirlei', 'Camily', 'Shirlei', 'Camily', 'Shirlei', 'Juliano', 'Analice', 'Camily', 'Juliano', 'Analice'],
  ['VOCAL 01', 'Maria', 'Tafarel', 'Ana Alice', 'Rodrigo', 'Maria', 'Analice', 'Mislane', 'Jossi', 'Camily', 'Mislane', 'Juliano', 'Jossi', 'John'],
  ['VOCAL 02', 'Allan', 'Rodrigo', 'Tafarel', '', 'Ana Alice', 'Giovani', 'Allan', 'Geovani', 'Allan', 'Giovani', 'Rodrigo', 'Geovani', 'Allan'],
  ['VOCAL 03', '', '', 'Giovani', '', 'Allan', 'Tafarel', '', '', '', '', 'Tafarel', '', ''],
  ['VIOLÃO', 'John', 'Juliano Dias', 'Ana Alice', 'Juliano Dias', 'Allan', 'Harley', 'Juliano', 'John', 'Juliano', 'Analice', 'John', 'Juliano', 'John'],
  ['TECLADO', 'Allan', 'Juninho', 'Lara', 'Juninho', 'Ana Alice', 'Lara', 'Allan', 'Juninho', 'Allan', 'Lara', 'Juninho', 'Lara', 'Allan'],
  ['CONTRA BAIXO', 'Vinicius/Pedro', 'Tafarel', 'Tafarel', 'Vinicius', 'Vinicius/Pedro', 'Tafarel', 'Vinicius/Pedro', 'Tafarel', 'Vinicius', 'Tafarel', 'Vinicius', 'Tafarel', 'Pedro'],
  ['GUITARRA', 'Diego', 'Rodrigo', 'Giovani', 'Rodrigo', 'Diego', 'Geovani', 'Diego', 'Geovani', 'Rodrigo', 'Geovani', 'Rodrigo', 'Geovani', 'Diego'],
  ['BATERIA', 'Kaue', 'Ivan', 'Harley', 'Ivan', 'Kaue', 'Ivan', 'Kaue', 'Harley', 'Ivan', 'Kaue', 'Harley', 'Ivan', 'Kaue'],
]

const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(quintaRows), 'quinta')
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(domingoRows), 'domingo')

const outFile = path.join(outDir, 'escala-conteudo-original.xlsx')
XLSX.writeFile(wb, outFile)

console.log(`Arquivo criado em: ${outFile}`)
