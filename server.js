const express = require('express');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'storage.json');
const EXCEL_FILE = path.join(DATA_DIR, 'permits_log.xlsx');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// دالة تحديث الإكسيل
async function updateExcelFile(permit) {
  let workbook = new ExcelJS.Workbook();
  if (fs.existsSync(EXCEL_FILE)) {
    await workbook.xlsx.readFile(EXCEL_FILE);
  } else {
    let worksheet = workbook.addWorksheet('سجل التصاريح');
    worksheet.columns = [
      { header: 'رقم التصريح', key: 'id', width: 15 },
      { header: 'نوع التصريح', key: 'typeName', width: 25 },
      { header: 'اسم العامل', key: 'workerName', width: 20 },
      { header: 'رقم التليفون', key: 'phone', width: 15 },
      { header: 'المنطقة', key: 'area', width: 20 },
      { header: 'حالة الطلب', key: 'status', width: 15 },
      { header: 'مشرف السلامة', key: 'safetyOfficer', width: 20 },
      { header: 'مدير المنطقة', key: 'areaManager', width: 20 },
      { header: 'سبب الرفض', key: 'rejectReason', width: 30 },
      { header: 'تاريخ الإنشاء', key: 'createdAt', width: 20 }
    ];
  }

  let worksheet = workbook.getWorksheet('سجل التصاريح');
  let found = false;

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber !== 1 && row.getCell(1).value === permit.id) {
      row.values = [
        permit.id, permit.typeName, permit.workerName, permit.phone, permit.area,
        permit.status, permit.safetyOfficer || '-', permit.areaManager || '-',
        permit.rejectReason || '-', permit.createdAt
      ];
      found = true;
    }
  });

  if (!found) {
    worksheet.addRow([
      permit.id, permit.typeName, permit.workerName, permit.phone, permit.area,
      permit.status, permit.safetyOfficer || '-', permit.areaManager || '-',
      permit.rejectReason || '-', permit.createdAt
    ]);
  }

  await workbook.xlsx.writeFile(EXCEL_FILE);
}

function readData() {
  if (!fs.existsSync(DATA_FILE)) return { permits: [] };
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data, updatedPermit) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  if (updatedPermit) {
    updateExcelFile(updatedPermit).catch(console.error);
  }
}

app.get('/api/permits', (req, res) => {
  res.json(readData().permits);
});

app.post('/api/permits', (req, res) => {
  const data = readData();
  const newPermit = {
    id: 'PRM-' + Date.now().toString().slice(-6),
    ...req.body,
    status: 'قيد الانتظار',
    createdAt: new Date().toLocaleString('ar-EG')
  };
  data.permits.push(newPermit);
  saveData(data, newPermit);
  res.json({ success: true, permit: newPermit });
});

app.put('/api/permits/:id', (req, res) => {
  const data = readData();
  const index = data.permits.findIndex(p => p.id === req.params.id);
  if (index !== -1) {
    data.permits[index] = { ...data.permits[index], ...req.body };
    saveData(data, data.permits[index]);
    res.json({ success: true, permit: data.permits[index] });
  } else {
    res.status(404).json({ error: 'التصريح غير موجود' });
  }
});

app.get('/api/export-excel', (req, res) => {
  if (fs.existsSync(EXCEL_FILE)) {
    res.download(EXCEL_FILE, 'سجل_تصاريح_العمل.xlsx');
  } else {
    res.status(404).send('لا يوجد سجل حالياً');
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));