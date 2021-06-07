function drawLineChart(canvasId, labels, fn, min, max) {
  var ctx = document.getElementById(canvasId);
  ctx.width = 400;
  ctx.height = 400;

  new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          data: labels.map(fn),
          borderColor: "rgba(0, 0, 0, 0.7)",
          pointRadius: 0,
          tension: 0.5,
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        legend: {
          display: false,
        },
      },
      scales: {
        x: {
          type: "linear",
          min: min,
          max: max,
          ticks: {
            stepSize: 1,
          },
          title: {
            display: true,
            text: "reserve of X",
          },
        },
        y: {
          type: "linear",
          min: min,
          max: max,
          title: {
            display: true,
            text: "reserve of Y",
          },
        },
      },
    },
  });
}
