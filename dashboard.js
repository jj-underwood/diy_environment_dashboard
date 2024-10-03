// dashboard.js
const configUrl = 'https://cloudfront-url/config.json';
let config;
const apiUrl = 'https://apigateway-url/data';
let allMetrics;
let allDevices;
const timePeriods = {
  glance: { main: { years: 0, months: 0, days: 1, hours: 0, minutes: 0 } },
  metric: { main: { years: 0, months: 0, days: 7, hours: 0, minutes: 0 }, subs: [{ years: 0, months: 0, days: 7 }] },
  device: { main: { years: 0, months: 0, days: 7, hours: 0, minutes: 0 }, subs: [{ years: 0, months: 0, days: 7 }] }
}
let intervalFunc;

document.addEventListener('DOMContentLoaded', async (event) => {  
  config = await fetchConfig(configUrl);
  console.log('Config:', config);
  allMetrics = config.metrics.map(a => a.metricsName);
  allDevices = config.devices.map(a => a.deviceName);
  populateSettingsModal(config);
  populateDashboard(config);
  
  // Initialize date range picker
  $('#dateTimes').daterangepicker({
    timePicker: true,
    timePicker24Hour: true,
    locale: {
      format: 'YYYY-MM-DD HH:mm'
    },
    ranges: {
      'Today': [moment().startOf('day'), moment().endOf('day')],
      'Yesterday': [moment().subtract(1, 'days').startOf('day'), moment().subtract(1, 'days').endOf('day')],
      'Last 7 Days': [moment().subtract(6, 'days').startOf('day'), moment().endOf('day')],
      'Last 30 Days': [moment().subtract(29, 'days').startOf('day'), moment().endOf('day')],
      'This Month': [moment().startOf('month'), moment().endOf('month')],
      'Last Month': [moment().subtract(1, 'month').startOf('month'), moment().subtract(1, 'month').endOf('month')],
      'This Year': [moment().startOf('year'), moment().endOf('year')],
      'Last Year': [moment().subtract(1, 'year').startOf('year'), moment().subtract(1, 'year').endOf('year')]
    }
  });
  
  // Handle Glance Mode button
  const glanceModeButton = document.getElementById('glanceModeButton');
  if (glanceModeButton) {
    glanceModeButton.addEventListener('click', () => {
      switchMode('glance', config);
      resetOtherSelection('glance');
    });
  }
  
  // Fetch data on metric selection
  document.getElementById('metricsSelect').addEventListener('change', function() {
    const selectedMetrics = [this.value];
    if (selectedMetrics[0]) {
      switchMode('metric', config, selectedMetrics);
      resetOtherSelection('metric');
    }
  });
  
  // Fetch data on device selection
  document.getElementById('deviceSelect').addEventListener('change', function() {
    const selectedDevices = [this.value];
    if (selectedDevices[0]) {
      switchMode('device', config, [], selectedDevices);
      resetOtherSelection('device');
    }
  });
  
  // Fetch data on date change
  $('#dateTimes').on('apply.daterangepicker', function(ev, picker) {
    const startTime = picker.startDate;
    const endTime = picker.endDate;
    
    if (startTime && endTime) {
      switchMode('daterange', config, [], [], startTime, endTime);
      resetOtherSelection('daterange');
    }
  });
  
  // Handle settings button
  document.getElementById('settings').addEventListener('click', openModal);
  document.getElementsByClassName('close')[0].addEventListener('click', closeModal);
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  
  // Initial data fetch for Glance Mode
  switchMode('glance', config);
});

// Function to reset the other dropdown
function resetOtherSelection(selected) {
  const metricsSelect = document.getElementById('metricsSelect');
  const deviceSelect = document.getElementById('deviceSelect');
  if (selected == 'glance') {
    metricsSelect.selectedIndex = 0;
    deviceSelect.selectedIndex = 0;
    $('#dateTimes').data('daterangepicker').setStartDate(moment().startOf('day'));
    $('#dateTimes').data('daterangepicker').setEndDate(moment().endOf('day'));
  } else if (selected == 'daterange') {
    metricsSelect.selectedIndex = 0;
    deviceSelect.selectedIndex = 0;
  } else if (selected === 'metric') {
    deviceSelect.selectedIndex = 0;
    $('#dateTimes').data('daterangepicker').setStartDate(moment().startOf('day'));
    $('#dateTimes').data('daterangepicker').setEndDate(moment().endOf('day'));
  } else if (selected === 'device') {
    metricsSelect.selectedIndex = 0;
    $('#dateTimes').data('daterangepicker').setStartDate(moment().startOf('day'));
    $('#dateTimes').data('daterangepicker').setEndDate(moment().endOf('day'));
  }
}

async function fetchConfig(url) {
  const token = localStorage.getItem('token');
  console.log('token', token);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    const config = await response.json();
    return config;
  } catch (error) {
    console.error('Error fetching config:', error);
    return {};
  }
}

function populateSettingsModal(config) {
  const devicesSettingsBody = document.querySelector('#devicesSettings tbody');
  const metricsSettingsBody = document.querySelector('#metricsSettings tbody');
  
  devicesSettingsBody.innerHTML = '';
  metricsSettingsBody.innerHTML = '';
  
  config.devices.forEach(device => {
    const deviceRow = document.createElement('tr');
    deviceRow.innerHTML = `
      <td>${device.deviceName}</td>
      <td><input type="text" value="${device.parameters.location}" placeholder="Location"></td>
      <td>
        <input type="color" value="${device.parameters.lineColor}" class="color-picker">
        <input type="text" value="${device.parameters.lineColor}" class="color-code" placeholder="#000000">
      </td>
    `;
    devicesSettingsBody.appendChild(deviceRow);
  });

  config.metrics.forEach(metric => {
    const metricRow = document.createElement('tr');
    metricRow.innerHTML = `
      <td>${metric.metricsName}</td>
      <td><input type="text" value="${metric.parameters.titleName}" placeholder="Title Name"></td>
      <td><input type="text" value="${metric.parameters.unitOfMeasurement}" placeholder="Unit of Measurement"></td>
    `;
    metricsSettingsBody.appendChild(metricRow);
  });

  document.querySelectorAll('.color-picker').forEach(picker => {
    picker.addEventListener('input', function() {
      this.nextElementSibling.value = this.value;
    });
  });

  document.querySelectorAll('.color-code').forEach(code => {
    code.addEventListener('input', function() {
      this.previousElementSibling.value = this.value;
    });
  });
}

function openModal() {
  document.getElementById('settingsModal').style.display = "block";
}

function closeModal() {
  document.getElementById('settingsModal').style.display = "none";
}

async function saveSettings() {
  const token = localStorage.getItem('token');
  const newConfig = {
    devices: [],
    metrics: []
  };

  document.querySelectorAll('#devicesSettings > tbody > tr').forEach(deviceRow => {
    const deviceName = deviceRow.querySelector('td:first-child').innerText;
    const location = deviceRow.querySelector('input[type="text"]').value;
    const lineColor = deviceRow.querySelector('input[type="color"]').value;
    newConfig.devices.push({ deviceName, parameters: { location, lineColor } });
  });

  document.querySelectorAll('#metricsSettings > tbody > tr').forEach(metricRow => {
    const metricsName = metricRow.querySelector('td:first-child').innerText;
    const titleName = metricRow.querySelector('input[type="text"]').value;
    const unitOfMeasurement = metricRow.querySelector('input[type="text"]').value;
    newConfig.metrics.push({ metricsName, parameters: { titleName, unitOfMeasurement } });
  });


  try {
    const response = await fetch(configUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(newConfig)
    });
    if (response.ok) {
      alert('Settings saved successfully!');
      closeModal();
      config = newConfig;
      populateDashboard(config);
    } else {
      alert('Failed to save settings.');
    }
  } catch (error) {
    console.error('Error saving settings:', error);
    alert('Error saving settings.');
  }
}

function populateDashboard(config) {
  const metricsSelect = document.getElementById('metricsSelect');
  metricsSelect.innerHTML = '<option value="" disabled selected>---</option>';
  config.metrics.forEach(metrics => {
    const option = document.createElement('option');
    option.value = metrics.metricsName;
    option.textContent = metrics.parameters.titleName;
    metricsSelect.appendChild(option);
  });
  
  const deviceSelect = document.getElementById('deviceSelect');
  deviceSelect.innerHTML = '<option value="" disabled selected>---</option>';
  config.devices.forEach(device => {
    const option = document.createElement('option');
    option.value = device.deviceName;
    option.textContent = device.parameters.location;
    deviceSelect.appendChild(option);
  });
}

async function switchMode(mode, config, selectedMetrics = [], selectedDevices = [], selectedStartTime = null, selectedEndTime = null) {
  console.log(mode, selectedMetrics, selectedDevices, selectedStartTime, selectedEndTime);
  clearInterval(intervalFunc);
  let periods, startTime, endTime;
  
  if (mode === 'glance') {
    endTime = moment();
    startTime = endTime.clone().subtract(timePeriods.glance.main);
    periods = [{ start: startTime, end: endTime, type: 'main'}];
    const promises = periods.map((period, index) => fetchData(allMetrics, allDevices, period, index));
    const data = await Promise.all(promises);
    const processedData = processData(data);
    updateCharts(config, processedData);
    intervalFunc = setInterval(async function() {
      if (document.visibilityState != 'visible') return;
      endTime = moment();
      startTime = endTime.clone().subtract(timePeriods.glance.main);
      periods = [{ start: startTime, end: endTime, type: 'main'}];
      const promises = periods.map((period, index) => fetchData(allMetrics, allDevices, period, index));
      const data = await Promise.all(promises);
      const processedData = processData(data);
      updateCharts(config, processedData);
    }, 30 * 60 * 1000);
  } else if (mode === 'daterange') {
    const startTime = selectedStartTime;
    const endTime = selectedEndTime;
    periods = [{ start: startTime, end: endTime, type: 'main'}];
    const promises = periods.map((period, index) => fetchData(allMetrics, allDevices, period, index));
    const data = await Promise.all(promises);
    const processedData = processData(data);
    updateCharts(config, processedData);
  } else if (mode === 'metric') {
    endTime = moment();
    startTime = endTime.clone().subtract(timePeriods.metric.main);
    periods = [{ start: startTime, end: endTime, type: 'main'}];
    timePeriods.metric.subs.forEach(item => {
      periods.push({ start: periods[0].start.clone().subtract(item), end: periods[0].end.clone().subtract(item), type: "metric" });
    })
    const promises = periods.map((period, index) => fetchData(selectedMetrics, allDevices, period, index));
    const data = await Promise.all(promises);
    const processedData = processData(data);
    updateCharts(config, processedData);
  } else if (mode === 'device') {
    endTime = moment();
    startTime = endTime.clone().subtract(timePeriods.device.main);
    periods = [{ start: startTime, end: endTime, type: 'main'}];
    timePeriods.device.subs.forEach(item => {
      periods.push({ start: periods[0].start.clone().subtract(item), end: periods[0].end.clone().subtract(item), type: "device" });
    })
    const promises = periods.map((period, index) => fetchData(allMetrics, selectedDevices, period, index));
    const data = await Promise.all(promises);
    const processedData = processData(data);
    updateCharts(config, processedData);
  }
}

async function fetchData(metrics, devices, period, periodIndex) {
  const token = localStorage.getItem('token');
  const startTimeUTC = period.start.toISOString().slice(0, 16);
  const endTimeUTC = period.end.toISOString().slice(0, 16);
  
  if (!devices.length || !metrics.length || !period.start || !period.end) {
    console.log('Missing selection');
    return;
  }
  
  const url = `${apiUrl}?metrics=${metrics.join(',')}&devices=${devices.join(',')}&start_time=${startTimeUTC}&end_time=${endTimeUTC}`;
  
  try {
    console.log('Fetching data from API:', url);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) {
      alert('Unauthorized Access');
      window.location.href = 'login.html';
    }
    const rawData = await response.json();
    return { periodIndex: periodIndex, period: period, data: rawData };
  } catch (error) {
    console.log('Error fetching data:', error);
    return { periodIndex: periodIndex, period: period, data: { data: [] }};
  }
}

function processData(dataArray) {
  dataArray.sort((a, b) => a.periodIndex - b.periodIndex);
  const processedData = {};
  const deviceNames = [];
  const metricsNames = [];
  const allTimes = new Set();
  const presenceTimes = new Set();
  
  dataArray.forEach(({ periodIndex, period, data }) => {
    console.log('periodIndex', periodIndex, 'period', period);
    const devNames = [];
    const metNames = [];
    const aTimes = new Set();
    const pTimes = new Set();
    
    if (!data) return;
    const rows = data.data;
    rows.forEach(row => {
      const time = new Date(row.time + "Z");
      time.setMilliseconds(0);
      let roundedTime;
      if (period.type === 'device') {
        const momentTime = moment(time);
        momentTime.add(timePeriods.device.subs[periodIndex - 1]);
        roundedTime = momentTime.toISOString();
      } else {
        roundedTime = time.toISOString();
      }
      let deviceName;
      if (period.type === 'device') {
        deviceName = row.device + "_" + periodIndex;
      } else {
        deviceName = row.device;
      }
      if (!processedData[deviceName]) {
        processedData[deviceName] = { device: row.device };
      }
      if (period.type === 'metric') {
        if (!devNames.includes(deviceName)) {
          devNames.push(deviceName);
        }
      } else {
        if (!deviceNames.includes(deviceName)) {
          deviceNames.push(deviceName);
        }
      }
      for (const [key, value] of Object.entries(row)) {
        if (key === 'time' || key === 'device') continue;
        let metricsName;
        if (period.type === 'metric') {
          metricsName = key + "_" + periodIndex;
        } else {
          metricsName = key;
        }
        if (period.type === 'metric') {
          if (!metNames.includes(metricsName)) {
            metNames.push(metricsName);
          }
        } else {
          if (!metricsNames.includes(metricsName)) {
            metricsNames.push(metricsName);
          }
        }
        if (value === null) continue;
        if (key === 'presence') {
          if (!processedData[deviceName][metricsName]) {
            processedData[deviceName][metricsName] = { value: [], type: key, period: period, periodIndex: periodIndex };
          }
          const presenceValue = value;
          const lastEntry = processedData[deviceName][metricsName].value[processedData[deviceName][metricsName].value.length - 1];
          if (lastEntry) {
            if (lastEntry.presence != presenceValue) {
              lastEntry.end = roundedTime;
              processedData[deviceName][metricsName].value.push({ start: roundedTime, end: roundedTime, presence: presenceValue });
            }
          } else {
            processedData[deviceName][metricsName].value.push({ start: roundedTime, end: roundedTime, presence: presenceValue });
          }
          if (period.type === 'metric') {
            pTimes.add(roundedTime);
          } else {
            presenceTimes.add(roundedTime);
          }
        } else {
          if (!processedData[deviceName][metricsName]) {
            processedData[deviceName][metricsName] = { time: [], value: [], type: key, period: period, periodIndex: periodIndex };
          }
          processedData[deviceName][metricsName].time.push(roundedTime);
          processedData[deviceName][metricsName].value.push(value);
          if (period.type === 'metric') {
            aTimes.add(roundedTime);
          } else {
            allTimes.add(roundedTime);
          }
        }
      }
    });
    if (period.type === 'metric') {
      const aTimesSorted = Array.from(aTimes).sort();
      const pTimesSorted = Array.from(pTimes).sort();
      for (const device of devNames) {
        for (const metrics of metNames) {
          if (!(metrics in processedData[device])) continue;
          if (metrics.startsWith('presence')) {
            const lastSegment = processedData[device][metrics].value[processedData[device][metrics].value.length - 1];
            const lastTime = pTimesSorted[pTimesSorted.length - 1];
            if (new Date(lastSegment.end) < new Date(lastTime)) {
              processedData[device][metrics].value.push({
                start: lastSegment.end,
                end: lastTime,
                presence: "off"
              })
            }
          } else {
            const timeMap = processedData[device][metrics].time.reduce((map, time, index) => {
              map[time] = processedData[device][metrics].value[index];
              return map;
            }, {});
            processedData[device][metrics] = {
              time: aTimesSorted,
              value: aTimesSorted.map(time => timeMap[time] ?? null),
              type: processedData[device][metrics].type,
              period: processedData[device][metrics].period,
              periodIndex: processedData[device][metrics].periodIndex
            };
          }
        }
      }
    }
  });
  if (allTimes.size === 0 && presenceTimes.size === 0) {
    return processedData;
  }
  
  const allTimesSorted = Array.from(allTimes).sort();
  const presenceTimesSorted = Array.from(presenceTimes).sort();
  
  for (const device of deviceNames) {
    for (const metric of metricsNames) {
      if (!(metric in processedData[device])) continue;
      if (metric.startsWith('presence')) {
        const lastSegment = processedData[device][metric].value[processedData[device][metric].value.length - 1];
        const lastTime = presenceTimesSorted[presenceTimesSorted.length - 1];
        if (new Date(lastSegment.end) < new Date(lastTime)) {
          processedData[device][metric].value.push({
            start: lastSegment.end,
            end: lastTime,
            presence: "off"
          })
        }
      } else {
        const timeMap = processedData[device][metric].time.reduce((map, time, index) => {
          map[time] = processedData[device][metric].value[index];
          return map;
        }, {});
        processedData[device][metric] = {
          time: allTimesSorted,
          value: allTimesSorted.map(time => timeMap[time] ?? null),
          type: processedData[device][metric].type,
          period: processedData[device][metric].period,
          periodIndex: processedData[device][metric].periodIndex
        };
      }
    }
  }
  return processedData;
}

function updateCharts(config, data) {
  const chartsContainer = document.getElementById('chartsContainer');
  chartsContainer.innerHTML = '';
  
  const chartParams = { 'metrics': {}, 'devices': {} };
  const metricsSet = new Set();
  allMetrics.forEach(metric => {
    const configParams = config.metrics.find(x => x.metricsName === metric);
    for (const device in data) {
      for (const met in data[device]) {
        if (data[device][met].type === metric) {
          metricsSet.add(met);
          if (!chartParams.metrics[met]){
            chartParams.metrics[met] = Object.assign({}, configParams.parameters);
          }
          if (met === metric) {
            chartParams.metrics[met].main = true;
          } else {
            chartParams.metrics[met].main = false;
          }
        }
      }
    }
  });
  const metrics = Array.from(metricsSet);
  
  metrics.forEach(metric => {
    const devices = [];
    allDevices.forEach(device => {
      const configParams = config.devices.find(x => x.deviceName === device);
      for (const dev in data) {
        if (metric in data[dev]) {
          if (data[dev]['device'] === device) {
            devices.push(dev);
            if (!chartParams.devices[dev]) {
              chartParams.devices[dev] = Object.assign({}, configParams.parameters);
            }
            if (dev === device) {
              chartParams.devices[dev].main = true;
            } else {
              chartParams.devices[dev].main = false;
            }
          }
        }
      }
    });
    if (devices.length === 0) {
      return;
    }
    const cardDiv = document.createElement('div');
    cardDiv.className = 'chart-card';
    const chartDiv = document.createElement('canvas');
    chartDiv.id = `${metric}Chart`;
    chartDiv.className = 'chart-container';
    cardDiv.appendChild(chartDiv);
    chartsContainer.appendChild(cardDiv);
    if (metric === 'presence') {
      drawPresenceChart(chartParams, data, metric, devices, chartDiv.id);
    } else {
      drawStepLineChart(chartParams, data, metric, devices, chartDiv.id);
    }
  });
}

function drawStepLineChart(config, data, metric, devices, chartDivId) {
  const ctx = document.getElementById(chartDivId).getContext('2d');

  const labels = data[devices[0]][metric]['time'].map((x) => new Date(x));
  
  const start = moment(data[devices[0]][metric].period.start);
  const startD = start.format('YYYY/MM/DD');
  const end = moment(data[devices[0]][metric].period.end);
  const endD = end.format('YYYY/MM/DD');
  
  let chartTitle;
  if (config.metrics[metric].main) {
    chartTitle = config.metrics[metric].titleName;
  } else {
    if (startD === endD) {
      chartTitle = `${config.metrics[metric].titleName} (${startD})`;
    } else {
      chartTitle = `${config.metrics[metric].titleName} (${startD} - ${endD})`;
    }
  }
  
  let yTitle;
  if ('unitOfMeasurement' in config.metrics[metric]) {
    yTitle = config.metrics[metric].unitOfMeasurement;
  }
  
  const datasets = devices.map(device => {
    if (!data[device] || !data[device][metric]) {
      console.log('no line');
      return null;
    }
    const values = labels.map(label => {
      const idx = data[device][metric]['time'].indexOf(label.toISOString());
      return idx !== -1 ? parseFloat(data[device][metric]['value'][idx]) : null;
    });
    const hasData = values.some(value => value !== null);
    if (!hasData) console.log('no value');
    
    const start = moment(data[device][metric].period.start);
    const startD = start.format('YYYY/MM/DD');
    const end = moment(data[device][metric].period.end);
    const endD = start.format('YYYY/MM/DD');
    let deviceLabel;
    if (config.devices[device].main) {
      deviceLabel = config.devices[device].location;
    } else {
      if (startD === endD) {
        deviceLabel = `${config.devices[device].location} (${startD})`;
      } else {
        deviceLabel = `${config.devices[device].location} (${startD} - ${endD})`;
      }
    }
    let dashedLine = [];
    if (!config.devices[device].main) {
      dashedLine = [5, 5];
    }
    
    if (hasData) {
      return {
        label: deviceLabel,
        data: values,
        borderColor: config.devices[device].lineColor || getRandomColor(),
        borderWidth: 1.5,
        borderDash: dashedLine,
        fill: false,
        stepped: true,
        pointRadius: 0,
        spanGaps: true
      };
    } else {
      return null;
    }
  }).filter(dataset => dataset !== null);

  new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: datasets
    },
    options: {
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'minute'
          },
          ticks: {
            maxTicksLimit: 10
          }
        },
        y: {
          title: {
            display: config.metrics[metric].unitOfMeasurement ? true : false,
            text: `(${config.metrics[metric].unitOfMeasurement})`
          }
        }
      },
      plugins: {
        title: {
          display: true,
          text: chartTitle,
          font: {
            size: 18,
            weight: 'normal'
          },
          padding: 20
        },
        legend: {
          display: true,
          position: 'top',
          labels: {
            usePointStyle: true,
            pointStyle: 'line'
          }
        },
        tooltip: {
          enabled: true,
          mode: 'index',
          intersect: false
        },
        crosshair: {
          line: {
            color: '#9E9E9E',
            width: 1,
            dashPattern: [5, 3]
          },
          sync: {
            enabled: false,
            group: 1,
            suppressTooltips: false
          },
          zoom: {
            enabled: false,
          },
          callbacks: {
            beforeZoom: function(start, end) {
              return true;
            },
            afterZoom: function(start, end) {
            }
          }
        }
      },
      elements: {
        line: {
          tension: 0.4
        }
      },
      hover: {
        mode: 'index',
        intersect: false
      }
    }
  });
}

function drawPresenceChart(config, data, metric, devices, chartDivId) {
  const ctx = document.getElementById(chartDivId).getContext('2d');
  
  const start = moment(data[devices[0]][metric].period.start);
  const startD = start.format('YYYY/MM/DD');
  const end = moment(data[devices[0]][metric].period.end);
  const endD = end.format('YYYY/MM/DD');
  
  let chartTitle;
  if (config.metrics[metric].main) {
    chartTitle = config.metrics[metric].titleName;
  } else {
    if (startD === endD) {
      chartTitle = `${config.metrics[metric].titleName} (${startD})`;
    } else {
      chartTitle = `${config.metrics[metric].titleName} (${startD} - ${endD})`;
    }
  }
  
  const datasets = [];
  const deviceLabels = [];
  devices.forEach(device => {
    const start = moment(data[device][metric].period.start);
    const startD = start.format('YYYY/MM/DD');
    const end = moment(data[device][metric].period.end);
    const endD = start.format('YYYY/MM/DD');
    let deviceLabel;
    if (config.devices[device].main) {
      deviceLabel = config.devices[device].location;
    } else {
      if (startD === endD) {
        deviceLabel = `${config.devices[device].location} (${startD})`;
      } else {
        deviceLabel = `${config.devices[device].location} (${startD} - ${endD})`;
      }
    }
    deviceLabels.push(deviceLabel);
    const segments = data[device][metric].value;
    segments.forEach(segment => {
      datasets.push({
        label: `${deviceLabel}`,
        data: [{
          x: [new Date(segment.start), new Date(segment.end)],
          y: deviceLabel
        }],
        backgroundColor: segment.presence === 'on' ? 'orange' : 'gray'
      });
    });
  });
  
  new Chart(ctx, {
    type: 'bar',
    data: {
      datasets: datasets
    },
    options: {
      indexAxis: 'y',
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'minute'
          },
          ticks: {
            maxTicksLimit: 10
          },
        },
        y: {
          stacked: true,
          type: 'category',
          labels: deviceLabels
        }
      },
      plugins: {
        title: {
          display: true,
          text: chartTitle,
          font: {
            size: 18,
            weight: 'normal'
          },
          padding: 20
        },
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const label = context.dataset.label || '';
            const start = new Date(context.raw.x[0]).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            const end = new Date(context.raw.x[1]).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
              return `${label}: ${start} - ${end}`;
            }
          }
        },
        crosshair: {
          line: {
            color: '#9E9E9E',
            width: 1,
            dashPattern: [5, 3]
          },
          sync: {
            enabled: false,
            group: 1,
            suppressTooltips: false
          },
          zoom: {
            enabled: false,
          },
          callbacks: {
            beforeZoom: function(start, end) {
              return true;
            },
            afterZoom: function(start, end) {
            }
          }
        }
      }
    }
  });
}

function getRandomColor() {
  const letters = '0123456789ABCDEF';
  let color = '#';
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

