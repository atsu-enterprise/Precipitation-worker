import { Hono } from 'hono'
import { jsx } from 'hono/jsx'
import { html, raw } from 'hono/html'
import * as cheerio from 'cheerio'

const app = new Hono()

// --- JMA Data Location Info ---
const LOCATIONS = {
    "47430": {"name": "函館", "prec_no": "23", "type": "s1"},
    "0147": {"name": "川汲", "prec_no": "23", "type": "a1"},
    "1462": {"name": "高松", "prec_no": "23", "type": "a1"},
    "1543": {"name": "戸井泊", "prec_no": "23", "type": "a1"}
};
const URL_TEMPLATE = "https://www.data.jma.go.jp/stats/etrn/view/daily_{url_type}.php?prec_no={prec_no}&block_no={block_no}&year={year}&month={month}&day=&view=";

// --- Layout Component ---
const Layout = (props) => html`<!DOCTYPE html>
  <html lang="ja">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${props.title}</title>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"><\/script>
      <style>
        body { font-family: sans-serif; margin: 2em; line-height: 1.6; background-color: #f9f9f9; color: #333; }
        .container { max-width: 800px; margin: auto; padding: 2em; border: 1px solid #ccc; border-radius: 8px; background-color: #fff; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        h1, h2 { color: #333; border-bottom: 2px solid #4a90e2; padding-bottom: 0.3em; }
        .chart-container { margin-top: 2em; }
        .form-container { margin-bottom: 2em; display: flex; flex-wrap: wrap; align-items: center; gap: 1em; }
        .form-container label { font-weight: bold; }
        .form-container input[type="date"], .form-container select { padding: 0.5em; border: 1px solid #ccc; border-radius: 4px; }
        .info-box { background-color: #e7f3fe; border-left: 6px solid #4a90e2; margin: 1em 0; padding: 0.5em 1em; transition: all 0.3s ease; }
        .calendar-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 2em; margin-top: 2em; }
        .calendar-table { border-collapse: collapse; width: 100%; table-layout: fixed; }
        .calendar-table th, .calendar-table td { border: 1px solid #ddd; width: 14.28%; text-align: center; vertical-align: top; height: 70px; }
        .calendar-table th { background-color: #f2f2f2; padding: 8px 0; }
        .calendar-table td { padding: 4px; }
        .calendar-table td .day { font-weight: bold; display: block; margin-bottom: 4px; }
        .calendar-table td .precipitation { font-size: 0.9em; color: #007bff; font-weight: bold; }
        .calendar-table td.base-date { background-color: #fff0b3; }
        .calendar-table td.weekend-sat { background-color: #f0f8ff; }
        .calendar-table td.weekend-sun { background-color: #fff0f0; }
        .calendar-table td.other-month .day { color: #ccc; }
        .calendar-table td.no-data .precipitation { color: #999; }
        .multi-container { max-width: 1800px; }
        .four-columns { display: flex; gap: 1.5em; justify-content: space-between; flex-wrap: wrap; }
        .location-panel { flex: 1; min-width: 300px; background: #f7faff; border: 1px solid #cce0f7; border-radius: 8px; padding: 1em; box-sizing: border-box; }
        .panel-header { border-bottom: 1px solid #ddd; padding-bottom: 0.5em; margin-bottom: 1em; }
        .panel-title { font-size: 1.1em; font-weight: bold; margin-bottom: 0.5em; color: #4a90e2; }
        .error { color: #d32f2f; background-color: #ffebee; padding: 0.5em; border-radius: 4px; margin: 0.5em 0; }
        .loading { color: #666; font-style: italic; }
        .highlight-3 { background-color: #fffbe6; border-left-color: #f59e0b; }
        .highlight-30 { background-color: #eff6ff; border-left-color: #3b82f6; }
        .highlight-both { background-color: #fef2f2; border-left-color: #ef4444; font-weight: bold; }
        .info-box.highlight-3 strong, .info-box.highlight-30 strong { color: #b45309; }
        .info-box.highlight-both strong { color: #b91c1c; font-size: 1.05em; }
      </style>
    </head>
    <body>
      ${props.children}
    </body>
  </html>`

// --- Page Components ---
const IndexPage = () => (
  <Layout title="雨量判定結果">
    <div className="container">
      <h1>雨量判定結果</h1>
      <div className="form-container">
        <label htmlFor="location-picker">観測地:</label>
        <select id="location-picker"></select>
        <label htmlFor="date-picker">基準日:</label>
        <input type="date" id="date-picker" />
      </div>
      <div id="results">
        <div id="info-box" className="info-box">
          <h2 id="location">場所: ...</h2>
          <p>基準日: <strong id="base-date">...</strong></p>
          <p>基準日までの3日間の合計雨量: <strong id="total-3-days">... mm</strong></p>
          <p>基準日までの30日間の合計雨量: <strong id="total-30-days">... mm</strong></p>
        </div>
        <div className="chart-container">
          <h2>過去30日間の降水量グラフ</h2>
          <canvas id="precipitationChart"></canvas>
        </div>
        <h2>過去30日間の降水量カレンダー</h2>
        <div id="calendar-container"></div>
      </div>
    </div>
    <script>
      {
        html`
        let chart;
        let locationPickerInitialized = false;
        async function fetchData(dateStr, blockNo) {
            document.getElementById('location').textContent = '場所: 読み込み中...';
            const response = await fetch('/api/precipitation?date=' + dateStr + '&block_no=' + blockNo);
            const data = await response.json();
            if (response.ok) {
                updateUI(data, blockNo);
            } else {
                alert('Error: ' + data.error);
                document.getElementById('location').textContent = '場所: エラー';
            }
        }
        function updateLocationPicker(locations, selectedBlockNo) {
            if (locationPickerInitialized || !locations) return;
            const picker = document.getElementById('location-picker');
            picker.innerHTML = '';
            for (const [block_no, info] of Object.entries(locations)) {
                const option = document.createElement('option');
                option.value = block_no;
                option.textContent = info.name;
                if (block_no === selectedBlockNo) {
                    option.selected = true;
                }
                picker.appendChild(option);
            }
            locationPickerInitialized = true;
        }
        function updateUI(data, blockNo) {
            updateLocationPicker(data.locations, blockNo);
            document.getElementById('location').textContent = '場所: ' + data.location;
            document.getElementById('base-date').textContent = data.base_date;
            document.getElementById('total-3-days').textContent = data.total_3_days.toFixed(1) + ' mm';
            document.getElementById('total-30-days').textContent = data.total_30_days.toFixed(1) + ' mm';

            const infoBox = document.getElementById('info-box');
            infoBox.className = 'info-box'; // Reset classes
            const cond3 = data.total_3_days <= 3;
            const cond30 = data.total_30_days <= 30;
            if (cond3 && cond30) {
                infoBox.classList.add('highlight-both');
            } else if (cond3) {
                infoBox.classList.add('highlight-3');
            } else if (cond30) {
                infoBox.classList.add('highlight-30');
            }

            updateChart(data.labels, data.data);
            updateCalendar(data.base_date, data.labels, data.data);
        }
        function updateChart(labels, values) {
            const ctx = document.getElementById('precipitationChart').getContext('2d');
            if (chart) {
                chart.destroy();
            }
            chart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '降水量 (mm)',
                        data: values,
                        backgroundColor: 'rgba(54, 162, 235, 0.6)',
                        borderColor: 'rgba(54, 162, 235, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    scales: {
                        y: { beginAtZero: true, title: { display: true, text: '降水量 (mm)' } },
                        x: { title: { display: true, text: '日付' } }
                    }
                }
            });
        }
        function updateCalendar(baseDateStr, labels, values) {
            const container = document.getElementById('calendar-container');
            container.innerHTML = '';
            const dataMap = new Map();
            for (let i = 0; i < labels.length; i++) {
                dataMap.set(labels[i], values[i]);
            }
            const baseDate = new Date(baseDateStr + 'T00:00:00');
            const currentMonth = baseDate.getMonth();
            const currentYear = baseDate.getFullYear();
            for (let i = 0; i < 2; i++) {
                const date = new Date(currentYear, currentMonth - i, 1);
                const calendarHTML = createMonthCalendar(date.getFullYear(), date.getMonth(), dataMap, baseDateStr);
                container.insertAdjacentHTML('afterbegin', calendarHTML);
            }
        }
        function createMonthCalendar(year, month, dataMap, baseDateStr) {
            const monthName = year + '年 ' + (month + 1) + '月';
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const firstDayOfWeek = new Date(year, month, 1).getDay();
            let tableHTML = '<div class="calendar-wrapper"><h3>' + monthName + '</h3><table class="calendar-table"><thead><tr><th>日</th><th>月</th><th>火</th><th>水</th><th>木</th><th>金</th><th>土</th></tr></thead><tbody><tr>';
            for (let i = 0; i < firstDayOfWeek; i++) { tableHTML += '<td class="other-month"></td>'; }
            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(year, month, day);
                const dayOfWeek = date.getDay();
                const dateStr = (month + 1).toString().padStart(2, '0') + '/' + day.toString().padStart(2, '0');
                const fullDateStr = year + '-' + (month + 1).toString().padStart(2, '0') + '-' + day.toString().padStart(2, '0');
                let cellClass = '';
                if (dayOfWeek === 0) cellClass += ' weekend-sun';
                if (dayOfWeek === 6) cellClass += ' weekend-sat';
                if (fullDateStr === baseDateStr) cellClass += ' base-date';
                let precipitationHTML = '<div class="precipitation no-data">-</div>';
                if (dataMap.has(dateStr)) {
                    const value = dataMap.get(dateStr);
                    precipitationHTML = '<div class="precipitation">' + value.toFixed(1) + ' mm</div>';
                }
                tableHTML += '<td class="' + cellClass.trim() + '"><div class="day">' + day + '</div>' + precipitationHTML + '</td>';
                if (dayOfWeek === 6) { tableHTML += '</tr><tr>'; }
            }
            const lastDayOfWeek = new Date(year, month, daysInMonth).getDay();
            if (lastDayOfWeek !== 6) { for (let i = lastDayOfWeek; i < 6; i++) { tableHTML += '<td class="other-month"></td>'; } }
            tableHTML += '</tr></tbody></table></div>';
            return tableHTML;
        }
        document.addEventListener('DOMContentLoaded', () => {
            const datePicker = document.getElementById('date-picker');
            const locationPicker = document.getElementById('location-picker');
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(today.getDate() - 1);
            const defaultDate = yesterday.toISOString().split('T')[0];
            datePicker.value = defaultDate;
            function handleUpdate() {
                const selectedDate = datePicker.value;
                const selectedLocation = locationPicker.value || '47430';
                fetchData(selectedDate, selectedLocation);
            }
            datePicker.addEventListener('change', handleUpdate);
            locationPicker.addEventListener('change', handleUpdate);
            handleUpdate();
        });
        `
      }
    </script>
  </Layout>
)

const MultiPage = () => (
    <Layout title="4地点同時表示 - 雨量判定結果">
      <div className="container multi-container">
        <h1>4地点同時表示 - 雨量判定結果</h1>
        <div style="margin-bottom:1.5em; display: flex; align-items: center; gap: 1.5em; flex-wrap: wrap;">
            <label htmlFor="date-picker">基準日:</label>
            <input type="date" id="date-picker" />
            <div id="location-pickers" style="display: flex; gap: 1em; flex-wrap: wrap;"></div>
        </div>
        <div className="four-columns" id="panels-container">
        </div>
        <div id="locations-data" style="display:none;">{JSON.stringify(LOCATIONS)}</div>
      </div>
      <script>
      {
          html`
          const charts = {};

          async function fetchDataForPanel(panelNumber) {
              const date = document.getElementById('date-picker').value;
              const blockNo = document.getElementById('location-picker-' + panelNumber).value;
              
              const panel = document.getElementById('panel-' + panelNumber);
              const infoBox = panel.querySelector('.info-box');
              infoBox.innerHTML = '<div class="loading">データを読み込み中...</div>';

              try {
                  const response = await fetch('/api/precipitation?date=' + date + '&block_no=' + blockNo);
                  if (!response.ok) {
                      const errorData = await response.json().catch(() => ({ error: 'Failed to fetch data' }));
                      throw new Error(errorData.error);
                  }
                  const data = await response.json();
                  updateUI(data, panelNumber);
              } catch (error) {
                  console.error('Error fetching data for panel ' + panelNumber, error);
                  showError(error.message, panelNumber);
              }
          }

          function showError(message, panelNumber) {
              const panel = document.getElementById('panel-' + panelNumber);
              if (panel) {
                  const infoBox = panel.querySelector('.info-box');
                  if(infoBox) infoBox.innerHTML = '<div class="error">' + message + '</div>';
              }
          }

          function updateUI(data, panelNumber) {
              const panel = document.getElementById('panel-' + panelNumber);
              if (!panel) return;

              const infoBox = panel.querySelector('.info-box');
              infoBox.className = 'info-box'; // Reset classes
              const cond3 = data.total_3_days <= 3;
              const cond30 = data.total_30_days <= 30;
              if (cond3 && cond30) {
                  infoBox.classList.add('highlight-both');
              } else if (cond3) {
                  infoBox.classList.add('highlight-3');
              } else if (cond30) {
                  infoBox.classList.add('highlight-30');
              }

              infoBox.innerHTML = '<h2>場所: ' + data.location + '</h2><p>基準日: <strong>' + data.base_date + '</strong></p><p>基準日までの3日間の合計雨量: <strong>' + data.total_3_days.toFixed(1) + ' mm</strong></p><p>基準日までの30日間の合計雨量: <strong>' + data.total_30_days.toFixed(1) + ' mm</strong></p>';
              updateChart(data.labels, data.data, panelNumber);
              updateCalendar(data.base_date, data.labels, data.data, panelNumber);
          }

          function updateChart(labels, values, panelNumber) {
              const canvas = document.getElementById('precipitationChart-' + panelNumber);
              if (!canvas) return;
              const ctx = canvas.getContext('2d');
              if (charts[panelNumber]) {
                  charts[panelNumber].destroy();
              }
              charts[panelNumber] = new Chart(ctx, {
                  type: 'bar',
                  data: {
                      labels: labels,
                      datasets: [{
                          label: '降水量 (mm)',
                          data: values,
                          backgroundColor: 'rgba(54, 162, 235, 0.6)',
                          borderColor: 'rgba(54, 162, 235, 1)',
                          borderWidth: 1
                      }]
                  },
                  options: {
                      responsive: true,
                      maintainAspectRatio: false,
                      scales: {
                          y: { 
                              beginAtZero: true, 
                              title: { display: true, text: '降水量 (mm)' }
                          },
                          x: { title: { display: true, text: '日付' } }
                      }
                  }
              });
          }

          function updateCalendar(baseDateStr, labels, values, panelNumber) {
              const container = document.getElementById('calendar-container-' + panelNumber);
              if (!container) return;
              container.innerHTML = '';
              const dataMap = new Map();
              labels.forEach((label, i) => dataMap.set(label, values[i]));
              const baseDate = new Date(baseDateStr + 'T00:00:00');
              for (let i = 0; i < 2; i++) {
                  const date = new Date(baseDate.getFullYear(), baseDate.getMonth() - i, 1);
                  container.insertAdjacentHTML('afterbegin', createMonthCalendar(date.getFullYear(), date.getMonth(), dataMap, baseDateStr));
              }
          }

          function createMonthCalendar(year, month, dataMap, baseDateStr) {
              const monthName = year + '年 ' + (month + 1) + '月';
              const daysInMonth = new Date(year, month + 1, 0).getDate();
              const firstDayOfWeek = new Date(year, month, 1).getDay();
              let tableHTML = '<div class="calendar-wrapper"><h4>' + monthName + '</h4><table class="calendar-table"><thead><tr><th>日</th><th>月</th><th>火</th><th>水</th><th>木</th><th>金</th><th>土</th></tr></thead><tbody><tr>';
              for (let i = 0; i < firstDayOfWeek; i++) tableHTML += '<td class="other-month"></td>';
              for (let day = 1; day <= daysInMonth; day++) {
                  const date = new Date(year, month, day);
                  const dateStr = (month + 1).toString().padStart(2, '0') + '/' + day.toString().padStart(2, '0');
                  const fullDateStr = year + '-' + (month + 1).toString().padStart(2, '0') + '-' + day.toString().padStart(2, '0');
                  let cellClass = '';
                  if (date.getDay() === 0) cellClass += ' weekend-sun';
                  if (date.getDay() === 6) cellClass += ' weekend-sat';
                  if (fullDateStr === baseDateStr) cellClass += ' base-date';
                  let precipHTML = dataMap.has(dateStr) ? '<div class="precipitation">' + dataMap.get(dateStr).toFixed(1) + 'mm</div>' : '<div class="precipitation no-data">-</div>';
                  tableHTML += '<td class="' + cellClass.trim() + '"><div class="day">' + day + '</div>' + precipHTML + '</td>';
                  if (date.getDay() === 6) tableHTML += '</tr><tr>';
              }
              const lastDayOfWeek = new Date(year, month, daysInMonth).getDay();
              if (lastDayOfWeek !== 6) { for (let i = lastDayOfWeek; i < 6; i++) tableHTML += '<td class="other-month"></td>'; }
              tableHTML += '</tr></tbody></table></div>';
              return tableHTML;
          }

          document.addEventListener('DOMContentLoaded', () => {
              const datePicker = document.getElementById('date-picker');
              const yesterday = new Date();
              yesterday.setDate(yesterday.getDate() - 1);
              datePicker.value = yesterday.toISOString().split('T')[0];
              
              const dataEl = document.getElementById('locations-data');
              const locationsData = JSON.parse(dataEl.textContent || '{}');
              const allBlockNos = Object.keys(locationsData);
              const pickerContainer = document.getElementById('location-pickers');
              const panelsContainer = document.getElementById('panels-container');

              for (let i = 1; i <= 4; i++) {
                  const panelId = 'panel-' + i;
                  const pickerId = 'location-picker-' + i;
                  const initialSelection = allBlockNos[i-1] || allBlockNos[0];

                  panelsContainer.insertAdjacentHTML('beforeend', '<div class="location-panel" id="' + panelId + '"><div class="panel-header"><div class="panel-title">地点 ' + i + '</div></div><div class="info-box"><div class="loading">...</div></div><div class="chart-container"><h3>過去30日間の降水量グラフ</h3><div style="height: 300px;"><canvas id="precipitationChart-' + i + '"></canvas></div></div><div class="calendar-container" id="calendar-container-' + i + '"></div></div>');

                  const label = document.createElement('label');
                  label.htmlFor = pickerId;
                  label.textContent = '地点' + i + ':';
                  
                  const select = document.createElement('select');
                  select.id = pickerId;
                  for(const blockNo of allBlockNos) {
                      const option = document.createElement('option');
                      option.value = blockNo;
                      option.textContent = locationsData[blockNo].name;
                      if (blockNo === initialSelection) {
                          option.selected = true;
                      }
                      select.appendChild(option);
                  }
                  
                  select.addEventListener('change', () => fetchDataForPanel(i));

                  pickerContainer.appendChild(label);
                  pickerContainer.appendChild(select);
              }

              const handleAllUpdates = () => {
                  for (let i = 1; i <= 4; i++) {
                      fetchDataForPanel(i);
                  }
              }

              datePicker.addEventListener('change', handleAllUpdates);
              handleAllUpdates(); // Initial fetch
          });
          `
      }
      </script>
    </Layout>
)

// --- Data Fetching Logic ---
async function getPrecipitationData(year, month, prec_no, block_no, url_type) {
    const url = URL_TEMPLATE
        .replace('{year}', year)
        .replace('{month}', month)
        .replace('{prec_no}', prec_no)
        .replace('{block_no}', block_no)
        .replace('{url_type}', url_type);
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('HTTP error! status: ' + response.status);
        }
        const buffer = await response.arrayBuffer();
        const decoder = new TextDecoder('shift_jis');
        const html = decoder.decode(buffer);
        return html;
    } catch (e) {
        console.error('Error fetching data for ' + year + '-' + month + ' (' + prec_no + '-' + block_no + '): ' + e);
        return null;
    }
}

function parseData(html_content, url_type) {
    const $ = cheerio.load(html_content);
    const table = $('#tablefix1');
    if (!table.length) return {};
    const precip_col_index = url_type === 's1' ? 3 : 1;
    const data = {};
    table.find('tr').slice(4).each((i, row) => {
        const cols = $(row).find('td');
        if (cols.length > precip_col_index && /^\d+$/.test($(cols[0]).text().trim())) {
            try {
                const day = parseInt($(cols[0]).text().trim(), 10);
                const precipitation_text = $(cols[precip_col_index]).text().trim().replace('--', '0').replace(')', '').replace(']', '');
                const precipitation = (precipitation_text && precipitation_text !== "") ? parseFloat(precipitation_text) : 0.0;
                if(!isNaN(precipitation)){
                    data[day] = precipitation;
                }
            } catch (e) {
                // ignore parsing errors
            }
        }
    });
    return data;
}

// --- Routes ---
app.get('/', (c) => c.html(<IndexPage />))
app.get('/multi', (c) => c.html(<MultiPage />))

app.get('/api/precipitation', async (c) => {
    const { date, block_no = '47430' } = c.req.query()
    const location_info = LOCATIONS[block_no];
    if (!location_info) {
        return c.json({ error: "Invalid location block_no" }, 400);
    }
    const { prec_no, name: location_name, type: url_type } = location_info;
    let base_date;
    try {
        base_date = new Date(date + 'T00:00:00');
        if (isNaN(base_date.getTime())) throw new Error('Invalid date');
    } catch (e) {
        base_date = new Date();
        base_date.setDate(base_date.getDate() - 1);
    }
    const monthly_data_cache = new Map();
    const get_month_data = async (year, month) => {
        const cache_key = year + '-' + month + '-' + prec_no + '-' + block_no;
        if (!monthly_data_cache.has(cache_key)) {
            const html_content = await getPrecipitationData(year, month, prec_no, block_no, url_type);
            monthly_data_cache.set(cache_key, html_content ? parseData(html_content, url_type) : {});
        }
        return monthly_data_cache.get(cache_key);
    };
    const precip_list = [];
    const labels = [];
    for (let i = 0; i < 30; i++) {
        const target_day = new Date(base_date);
        target_day.setDate(target_day.getDate() - i);
        const year = target_day.getFullYear();
        const month = target_day.getMonth() + 1;
        const day = target_day.getDate();
        const month_data = await get_month_data(year, month);
        precip_list.push(month_data[day] || 0.0);
        const labelMonth = (target_day.getMonth() + 1).toString().padStart(2, '0');
        const labelDay = target_day.getDate().toString().padStart(2, '0');
        labels.push(labelMonth + '/' + labelDay);
    }
    precip_list.reverse();
    labels.reverse();
    const total_3_days = precip_list.slice(-3).reduce((a, b) => a + b, 0);
    const total_30_days = precip_list.reduce((a, b) => a + b, 0);
    const baseDateStr = base_date.getFullYear() + '-' + (base_date.getMonth() + 1).toString().padStart(2, '0') + '-' + base_date.getDate().toString().padStart(2, '0');
    return c.json({
        location: location_name,
        base_date: baseDateStr,
        total_3_days: total_3_days,
        total_30_days: total_30_days,
        labels: labels,
        data: precip_list,
        locations: LOCATIONS 
    });
});

export default app