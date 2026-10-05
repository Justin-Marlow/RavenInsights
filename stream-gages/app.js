(() => {
  'use strict';

  const API_BASE =
    'https://wtrba-stream-proxy.jstmarlow.workers.dev/';

  const stations =
    window.STREAM_GAGE_STATIONS || [];

  let activeStation =
    stations[0] || null;

  let activeRange = '7d';

  let waterSeries = [];
  let batterySeries = [];

  const stationSnapshots = new Map();

  const $ = (id) =>
    document.getElementById(id);


  // =========================================================
  // DATA FETCHING
  // =========================================================

  function normalizeTimestamp(value) {
    const n = Number(value);

    if (!Number.isFinite(n)) {
      return null;
    }

    if (n > 1e17) {
      return n / 1_000_000;
    }

    if (n > 1e14) {
      return n / 1_000;
    }

    return n;
  }


  async function fetchStationData(
    station,
    type,
    range
  ) {
    const url =
      new URL(API_BASE);

    url.searchParams.set(
      'station',
      station.id
    );

    url.searchParams.set(
      'type',
      type
    );

    url.searchParams.set(
      'range',
      range
    );

    const response =
      await fetch(
        url.toString(),
        {
          headers: {
            Accept:
              'application/json'
          }
        }
      );

    if (!response.ok) {
      throw new Error(
        `Data request failed: ${response.status}`
      );
    }

    return response.json();
  }


  function parseSeries(
    payload,
    multiplier = 1
  ) {
    const values =
      payload?.results?.[0]
        ?.series?.[0]
        ?.values || [];

    return values.map(
      ([time, value]) => ({
        time:
          normalizeTimestamp(time),

        value:
          value == null
            ? null
            : Number(value) *
              multiplier
      })
    );
  }


  // =========================================================
  // DATA HELPERS
  // =========================================================

  function validPoints(series) {
    return series.filter(
      (point) =>
        point.time != null &&
        point.value != null &&
        Number.isFinite(
          point.value
        )
    );
  }


  function lastValid(series) {
    for (
      let i =
        series.length - 1;
      i >= 0;
      i--
    ) {
      const point =
        series[i];

      if (
        point.value != null &&
        Number.isFinite(
          point.value
        )
      ) {
        return point;
      }
    }

    return null;
  }


  function nearestValueAtOrBefore(
    series,
    targetTime
  ) {
    const valid =
      validPoints(series);

    let candidate = null;

    for (
      const point of valid
    ) {
      if (
        point.time <=
        targetTime
      ) {
        candidate = point;
      } else {
        break;
      }
    }

    return candidate;
  }


  function deltaForHours(
    series,
    hours
  ) {
    const latest =
      lastValid(series);

    if (!latest) {
      return null;
    }

    const target =
      latest.time -
      hours *
        60 *
        60 *
        1000;

    const previous =
      nearestValueAtOrBefore(
        series,
        target
      );

    if (!previous) {
      return null;
    }

    return (
      latest.value -
      previous.value
    );
  }


  function periodStats(series) {
    const valid =
      validPoints(series);

    if (!valid.length) {
      return {
        high: null,
        low: null
      };
    }

    const values =
      valid.map(
        (point) =>
          point.value
      );

    return {
      high:
        Math.max(...values),

      low:
        Math.min(...values)
    };
  }


  function getRangeMilliseconds() {
    if (
      activeRange === '1d'
    ) {
      return (
        24 *
        60 *
        60 *
        1000
      );
    }

    if (
      activeRange === '30d'
    ) {
      return (
        30 *
        24 *
        60 *
        60 *
        1000
      );
    }

    return (
      7 *
      24 *
      60 *
      60 *
      1000
    );
  }


  // =========================================================
  // FORMATTING
  // =========================================================

  function formatNumber(
    value,
    decimals = 2
  ) {
    return Number.isFinite(
      value
    )
      ? value.toFixed(
          decimals
        )
      : '—';
  }


  function formatDateTime(ms) {
    if (!ms) {
      return '—';
    }

    return new Intl.DateTimeFormat(
      'en-US',
      {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      }
    ).format(
      new Date(ms)
    );
  }


  function relativeAge(ms) {
    if (!ms) {
      return 'No reading';
    }

    const minutes =
      Math.max(
        0,
        Math.round(
          (
            Date.now() -
            ms
          ) /
            60000
        )
      );

    if (
      minutes < 60
    ) {
      return `${minutes} min ago`;
    }

    const hours =
      Math.round(
        minutes / 60
      );

    if (
      hours < 48
    ) {
      return `${hours} hr ago`;
    }

    return `${Math.round(
      hours / 24
    )} days ago`;
  }


  function getStatus(
    station,
    lastWater
  ) {
    if (!lastWater) {
      return {
        text: 'No data',
        className:
          'status-unknown'
      };
    }

    const ageMinutes =
      (
        Date.now() -
        lastWater.time
      ) /
      60000;

    if (
      ageMinutes <=
      station.status
        .delayedMinutes
    ) {
      return {
        text: 'Online',
        className:
          'status-online'
      };
    }

    if (
      ageMinutes <=
      station.status
        .offlineMinutes
    ) {
      return {
        text: 'Delayed',
        className:
          'status-delayed'
      };
    }

    return {
      text:
        'Offline / stale',
      className:
        'status-offline'
    };
  }


  function trendInfo(delta) {
    if (
      !Number.isFinite(
        delta
      )
    ) {
      return {
        label:
          'Not enough data',
        arrow: ''
      };
    }

    if (
      Math.abs(delta) <
      0.02
    ) {
      return {
        label: 'Stable',
        arrow: '→'
      };
    }

    if (
      delta > 0
    ) {
      return {
        label: 'Rising',
        arrow: '↑'
      };
    }

    return {
      label: 'Falling',
      arrow: '↓'
    };
  }


  // =========================================================
  // ERROR MESSAGE
  // =========================================================

  function setError(
    message = ''
  ) {
    const banner =
      $('errorBanner');

    if (!banner) {
      return;
    }

    if (!message) {
      banner.hidden = true;
      banner.textContent = '';
      return;
    }

    banner.hidden = false;
    banner.textContent =
      message;
  }


  // =========================================================
  // SIDEBAR / STATION LIST
  // =========================================================

  function renderStationList() {
    $('stationCount')
      .textContent =
      String(
        stations.length
      );

    $('stationList')
      .innerHTML = '';

    stations.forEach(
      (station) => {
        const button =
          document.createElement(
            'button'
          );

        const snapshot =
          stationSnapshots.get(
            station.id
          );

        button.className =
          `station-button${
            activeStation?.id ===
            station.id
              ? ' active'
              : ''
          }`;

        button.type =
          'button';

        let snapshotHtml = '';

        if (
          snapshot?.reading
        ) {
          snapshotHtml = `
            <span class="station-snapshot">
              <span
                class="status-dot ${snapshot.status.className}">
              </span>

              ${snapshot.reading.value.toFixed(2)} ft
            </span>
          `;
        } else {
          snapshotHtml = `
            <span class="station-snapshot">
              Loading…
            </span>
          `;
        }

        button.innerHTML = `
          <strong>
            ${station.name}
          </strong>

          ${snapshotHtml}
        `;

        button.addEventListener(
          'click',
          () => {
            activeStation =
              station;

            renderStationList();

            loadActiveStation();
          }
        );

        $('stationList')
          .appendChild(
            button
          );
      }
    );
  }


  async function loadStationSnapshots() {
    await Promise.all(
      stations.map(
        async (station) => {
          try {
            const payload =
              await fetchStationData(
                station,
                'water',
                '1d'
              );

            const series =
              parseSeries(
                payload
              );

            const reading =
              lastValid(
                series
              );

            stationSnapshots.set(
              station.id,
              {
                reading,

                status:
                  getStatus(
                    station,
                    reading
                  )
              }
            );

          } catch {
            stationSnapshots.set(
              station.id,
              {
                reading: null,

                status: {
                  text:
                    'Unavailable',

                  className:
                    'status-offline'
                }
              }
            );
          }
        }
      )
    );

    renderStationList();
  }


  // =========================================================
  // METRICS
  // =========================================================

  function renderMetrics() {
    const station =
      activeStation;

    if (!station) {
      return;
    }

    const latestWater =
      lastValid(
        waterSeries
      );

    const latestBattery =
      lastValid(
        batterySeries
      );

    const delta6 =
      deltaForHours(
        waterSeries,
        6
      );

    const delta24 =
      deltaForHours(
        waterSeries,
        24
      );

    const trend6 =
      trendInfo(
        delta6
      );

    const trend24 =
      trendInfo(
        delta24
      );

    const stats =
      periodStats(
        waterSeries
      );

    const status =
      getStatus(
        station,
        latestWater
      );


    $('stationName')
      .textContent =
      station.name;


    $('stationDescription')
      .textContent =
      station.description ||
      '';


    $('statusBadge')
      .textContent =
      status.text;


    $('statusBadge')
      .className =
      `status-badge ${status.className}`;


    $('waterValue')
      .textContent =
      latestWater
        ? formatNumber(
            latestWater.value,
            station.water
              .decimals ?? 2
          )
        : '—';


    $('waterUnit')
      .textContent =
      station.water.unit ||
      'ft';


    $('waterUpdated')
      .textContent =
      latestWater
        ? `Updated ${formatDateTime(
            latestWater.time
          )} · ${relativeAge(
            latestWater.time
          )}`
        : 'No reading';


    $('change6h')
      .textContent =
      Number.isFinite(
        delta6
      )
        ? `${trend6.arrow} ${
            delta6 >= 0
              ? '+'
              : ''
          }${delta6.toFixed(2)}`
        : '—';


    $('trend6h')
      .textContent =
      trend6.label;


    $('change24h')
      .textContent =
      Number.isFinite(
        delta24
      )
        ? `${trend24.arrow} ${
            delta24 >= 0
              ? '+'
              : ''
          }${delta24.toFixed(2)}`
        : '—';


    $('trend24h')
      .textContent =
      trend24.label;


    if (
      $('periodHigh')
    ) {
      $('periodHigh')
        .textContent =
        formatNumber(
          stats.high,
          2
        );
    }


    if (
      $('periodLow')
    ) {
      $('periodLow')
        .textContent =
        formatNumber(
          stats.low,
          2
        );
    }


    const batteryValue =
      latestBattery?.value;


    $('batteryValue')
      .textContent =
      Number.isFinite(
        batteryValue
      )
        ? formatNumber(
            batteryValue,
            station.battery
              .decimals ?? 0
          )
        : '—';


    $('batteryUpdated')
      .textContent =
      latestBattery
        ? `Updated ${formatDateTime(
            latestBattery.time
          )} · ${relativeAge(
            latestBattery.time
          )}`
        : 'No reading';


    const batteryPct =
      Number.isFinite(
        batteryValue
      )
        ? Math.max(
            0,
            Math.min(
              100,
              batteryValue
            )
          )
        : 0;


    $('batteryBar')
      .style.width =
      `${batteryPct}%`;


    $('lastWaterReading')
      .textContent =
      latestWater
        ? `${formatDateTime(
            latestWater.time
          )} (${relativeAge(
            latestWater.time
          )})`
        : '—';


    $('lastBatteryReading')
      .textContent =
      latestBattery
        ? `${formatDateTime(
            latestBattery.time
          )} (${relativeAge(
            latestBattery.time
          )})`
        : '—';


    if (
      $('referenceElevation')
    ) {
      $('referenceElevation')
        .textContent =
        Number.isFinite(
          station.referenceElevation
        )
          ? `${station.referenceElevation.toFixed(2)} ft`
          : '—';
    }


    if (
      $('reportingRange')
    ) {
      $('reportingRange')
        .textContent =
        activeRange === '1d'
          ? '24 hours'
          : activeRange === '7d'
          ? '7 days'
          : '30 days';
    }
  }


  // =========================================================
  // SVG HELPERS
  // =========================================================

  function svgEl(
    name,
    attrs = {}
  ) {
    const el =
      document.createElementNS(
        'http://www.w3.org/2000/svg',
        name
      );

    Object.entries(
      attrs
    ).forEach(
      ([key, value]) => {
        el.setAttribute(
          key,
          String(value)
        );
      }
    );

    return el;
  }


  function splitIntoSegments(
    series
  ) {
    const segments = [];

    let current = [];

    for (
      const point of series
    ) {
      if (
        point.value == null ||
        !Number.isFinite(
          point.value
        )
      ) {
        if (
          current.length
        ) {
          segments.push(
            current
          );

          current = [];
        }

        continue;
      }

      current.push(
        point
      );
    }

    if (
      current.length
    ) {
      segments.push(
        current
      );
    }

    return segments;
  }


  // =========================================================
  // HYDROGRAPH
  // =========================================================

  function renderChart() {
    const svg =
      $('waterChart');

    const emptyMessage =
      $('chartEmpty');

    const tooltip =
      $('chartTooltip');

    svg.innerHTML = '';

    if (
      tooltip
    ) {
      tooltip.hidden = true;
    }


    const points =
      validPoints(
        waterSeries
      );


    if (
      points.length < 2
    ) {
      emptyMessage.hidden =
        false;

      return;
    }


    emptyMessage.hidden =
      true;


    const W = 1000;
    const H = 360;


    const pad = {
      l: 65,
      r: 30,
      t: 24,
      b: 44
    };


    const innerW =
      W -
      pad.l -
      pad.r;


    const innerH =
      H -
      pad.t -
      pad.b;


    // ---------------------------------------------------------
    // FULL SELECTED TIME WINDOW
    // ---------------------------------------------------------

    const maxT =
      Date.now();


    const minT =
      maxT -
      getRangeMilliseconds();


    const visiblePoints =
      points.filter(
        (point) =>
          point.time >= minT &&
          point.time <= maxT
      );


    if (
      visiblePoints.length < 2
    ) {
      emptyMessage.hidden =
        false;

      return;
    }


    // ---------------------------------------------------------
    // Y RANGE
    // ---------------------------------------------------------

    const values =
      visiblePoints.map(
        (point) =>
          point.value
      );


    const thresholds =
      activeStation
        ?.thresholds ||
      {};


    if (
      Number.isFinite(
        thresholds.action
      )
    ) {
      values.push(
        thresholds.action
      );
    }


    if (
      Number.isFinite(
        thresholds.flood
      )
    ) {
      values.push(
        thresholds.flood
      );
    }


    let minV =
      Math.min(
        ...values
      );


    let maxV =
      Math.max(
        ...values
      );


    const spanV =
      Math.max(
        0.25,
        maxV -
          minV
      );


    minV -=
      spanV * 0.12;


    maxV +=
      spanV * 0.12;


    // ---------------------------------------------------------
    // COORDINATE FUNCTIONS
    // ---------------------------------------------------------

    const x = (time) =>
      pad.l +
      (
        (
          time -
          minT
        ) /
        Math.max(
          1,
          maxT -
            minT
        )
      ) *
        innerW;


    const y = (value) =>
      pad.t +
      (
        1 -
        (
          (
            value -
            minV
          ) /
          Math.max(
            0.001,
            maxV -
              minV
          )
        )
      ) *
        innerH;


    // ---------------------------------------------------------
    // Y AXIS / GRID
    // ---------------------------------------------------------

    for (
      let i = 0;
      i <= 4;
      i++
    ) {
      const yy =
        pad.t +
        (
          innerH /
          4
        ) *
          i;


      svg.appendChild(
        svgEl(
          'line',
          {
            x1:
              pad.l,

            y1:
              yy,

            x2:
              W -
              pad.r,

            y2:
              yy,

            class:
              'chart-grid-line'
          }
        )
      );


      const label =
        svgEl(
          'text',
          {
            x:
              pad.l -
              10,

            y:
              yy +
              4,

            'text-anchor':
              'end',

            class:
              'chart-axis-label'
          }
        );


      label.textContent =
        (
          maxV -
          (
            (
              maxV -
              minV
            ) /
            4
          ) *
            i
        ).toFixed(1);


      svg.appendChild(
        label
      );
    }


    // ---------------------------------------------------------
    // X AXIS
    // ---------------------------------------------------------

    const tickCount = 4;


    for (
      let i = 0;
      i <=
        tickCount;
      i++
    ) {
      const tt =
        minT +
        (
          (
            maxT -
            minT
          ) /
          tickCount
        ) *
          i;


      const label =
        svgEl(
          'text',
          {
            x:
              x(tt),

            y:
              H -
              12,

            'text-anchor':
              i === 0
                ? 'start'
                : i ===
                    tickCount
                ? 'end'
                : 'middle',

            class:
              'chart-axis-label'
          }
        );


      if (
        activeRange ===
        '1d'
      ) {
        label.textContent =
          new Intl.DateTimeFormat(
            'en-US',
            {
              hour:
                'numeric',

              minute:
                '2-digit'
            }
          ).format(
            new Date(tt)
          );
      } else {
        label.textContent =
          new Intl.DateTimeFormat(
            'en-US',
            {
              month:
                'short',

              day:
                'numeric'
            }
          ).format(
            new Date(tt)
          );
      }


      svg.appendChild(
        label
      );
    }


    // ---------------------------------------------------------
    // THRESHOLDS
    // ---------------------------------------------------------

    function drawThreshold(
      value,
      label,
      className
    ) {
      if (
        !Number.isFinite(
          value
        )
      ) {
        return;
      }


      const yy =
        y(value);


      svg.appendChild(
        svgEl(
          'line',
          {
            x1:
              pad.l,

            y1:
              yy,

            x2:
              W -
              pad.r,

            y2:
              yy,

            class:
              className
          }
        )
      );


      const text =
        svgEl(
          'text',
          {
            x:
              W -
              pad.r -
              5,

            y:
              yy -
              6,

            'text-anchor':
              'end',

            class:
              'threshold-label'
          }
        );


      text.textContent =
        `${label}: ${value.toFixed(2)} ft`;


      svg.appendChild(
        text
      );
    }


    drawThreshold(
      thresholds.action,
      'Action',
      'threshold-action'
    );


    drawThreshold(
      thresholds.flood,
      'Flood',
      'threshold-flood'
    );


    // ---------------------------------------------------------
    // DATA LINE
    // ---------------------------------------------------------

    const segments =
      splitIntoSegments(
        waterSeries
      );


    segments.forEach(
      (segment) => {
        const visibleSegment =
          segment.filter(
            (point) =>
              point.time >=
                minT &&
              point.time <=
                maxT
          );


        if (
          visibleSegment.length <
          2
        ) {
          return;
        }


        const linePath =
          visibleSegment
            .map(
              (
                point,
                index
              ) =>
                `${
                  index === 0
                    ? 'M'
                    : 'L'
                } ${
                  x(
                    point.time
                  ).toFixed(1)
                } ${
                  y(
                    point.value
                  ).toFixed(1)
                }`
            )
            .join(' ');


        svg.appendChild(
          svgEl(
            'path',
            {
              d:
                linePath,

              class:
                'chart-line'
            }
          )
        );
      }
    );


    // ---------------------------------------------------------
    // LATEST POINT
    // ---------------------------------------------------------

    const last =
      lastValid(
        waterSeries
      );


    if (
      last &&
      last.time >= minT &&
      last.time <= maxT
    ) {
      svg.appendChild(
        svgEl(
          'circle',
          {
            cx:
              x(
                last.time
              ),

            cy:
              y(
                last.value
              ),

            r:
              4.5,

            class:
              'chart-point'
          }
        )
      );
    }


    // ---------------------------------------------------------
    // HOVER ELEMENTS
    // ---------------------------------------------------------

    const hoverLine =
      svgEl(
        'line',
        {
          class:
            'chart-hover-line',

          y1:
            pad.t,

          y2:
            H -
            pad.b,

          visibility:
            'hidden'
        }
      );


    const hoverPoint =
      svgEl(
        'circle',
        {
          r:
            5,

          class:
            'chart-hover-point',

          visibility:
            'hidden'
        }
      );


    svg.appendChild(
      hoverLine
    );


    svg.appendChild(
      hoverPoint
    );


    /*
      The transparent hover overlay covers
      only the actual plotting area.
    */

    const overlay =
      svgEl(
        'rect',
        {
          x:
            pad.l,

          y:
            pad.t,

          width:
            innerW,

          height:
            innerH,

          fill:
            'transparent',

          class:
            'chart-hover-overlay'
        }
      );


    svg.appendChild(
      overlay
    );


    // ---------------------------------------------------------
    // CORRECT SVG HOVER TRACKING
    // ---------------------------------------------------------

    overlay.addEventListener(
      'mousemove',
      (event) => {

        /*
          Use the browser's SVG transformation
          system instead of manually estimating
          the screen-to-SVG coordinate conversion.
        */

        const svgPoint =
          svg.createSVGPoint();


        svgPoint.x =
          event.clientX;


        svgPoint.y =
          event.clientY;


        const screenMatrix =
          svg.getScreenCTM();


        if (
          !screenMatrix
        ) {
          return;
        }


        const transformedPoint =
          svgPoint.matrixTransform(
            screenMatrix.inverse()
          );


        /*
          Clamp the cursor to the real
          hydrograph plotting boundaries.
        */

        const guideX =
          Math.max(
            pad.l,
            Math.min(
              W -
                pad.r,
              transformedPoint.x
            )
          );


        /*
          Convert cursor position within the
          plot into a 0-1 percentage.
        */

        const plotPercent =
          (
            guideX -
            pad.l
          ) /
          innerW;


        /*
          Convert the percentage to a timestamp
          across the entire selected time window.
        */

        const targetTime =
          minT +
          plotPercent *
          (
            maxT -
            minT
          );


        /*
          Find the actual observation closest
          to that time.
        */

        let nearest =
          visiblePoints[0];


        let nearestDiff =
          Math.abs(
            nearest.time -
            targetTime
          );


        for (
          const point of visiblePoints
        ) {
          const diff =
            Math.abs(
              point.time -
              targetTime
            );


          if (
            diff <
            nearestDiff
          ) {
            nearest =
              point;

            nearestDiff =
              diff;
          }
        }


        /*
          The dashed vertical guide follows
          the cursor exactly.
        */

        hoverLine.setAttribute(
          'x1',
          guideX
        );


        hoverLine.setAttribute(
          'x2',
          guideX
        );


        hoverLine.setAttribute(
          'visibility',
          'visible'
        );


        /*
          The circle stays on the nearest
          actual observation.
        */

        const pointX =
          x(
            nearest.time
          );


        const pointY =
          y(
            nearest.value
          );


        hoverPoint.setAttribute(
          'cx',
          pointX
        );


        hoverPoint.setAttribute(
          'cy',
          pointY
        );


        hoverPoint.setAttribute(
          'visibility',
          'visible'
        );


        /*
          Tooltip follows the mouse horizontally,
          while displaying the nearest real
          sensor reading.
        */

        if (
          tooltip
        ) {
          tooltip.hidden =
            false;


          tooltip.innerHTML = `
            <strong>
              ${formatDateTime(nearest.time)}
            </strong>

            <span>
              ${nearest.value.toFixed(2)} ft
            </span>
          `;


          const svgRect =
            svg.getBoundingClientRect();


          const tooltipLeft =
            event.clientX -
            svgRect.left;


          /*
            Convert actual SVG Y coordinate
            to rendered browser pixels for
            tooltip placement.
          */

          const topPoint =
            svg.createSVGPoint();


          topPoint.x =
            pointX;


          topPoint.y =
            pointY;


          const screenPoint =
            topPoint.matrixTransform(
              screenMatrix
            );


          const tooltipTop =
            screenPoint.y -
            svgRect.top;


          tooltip.style.left =
            `${tooltipLeft}px`;


          tooltip.style.top =
            `${tooltipTop}px`;
        }
      }
    );


    overlay.addEventListener(
      'mouseleave',
      () => {
        hoverLine.setAttribute(
          'visibility',
          'hidden'
        );


        hoverPoint.setAttribute(
          'visibility',
          'hidden'
        );


        if (
          tooltip
        ) {
          tooltip.hidden =
            true;
        }
      }
    );
  }


  // =========================================================
  // CSV EXPORT
  // =========================================================

  function exportCsv() {
    if (
      !activeStation
    ) {
      return;
    }


    const valid =
      validPoints(
        waterSeries
      );


    if (
      !valid.length
    ) {
      alert(
        'No water-level data available to export.'
      );

      return;
    }


    const rows = [
      [
        'Station',
        'Timestamp',
        'Water Elevation (ft)'
      ]
    ];


    valid.forEach(
      (point) => {
        rows.push([
          activeStation.name,

          new Date(
            point.time
          ).toISOString(),

          point.value.toFixed(
            3
          )
        ]);
      }
    );


    const csv =
      rows
        .map(
          (row) =>
            row
              .map(
                (value) =>
                  `"${String(
                    value
                  ).replaceAll(
                    '"',
                    '""'
                  )}"`
              )
              .join(',')
        )
        .join('\n');


    const blob =
      new Blob(
        [csv],
        {
          type:
            'text/csv;charset=utf-8'
        }
      );


    const url =
      URL.createObjectURL(
        blob
      );


    const link =
      document.createElement(
        'a'
      );


    link.href =
      url;


    link.download =
      `${activeStation.id}-${activeRange}-hydrograph.csv`;


    document.body
      .appendChild(
        link
      );


    link.click();


    link.remove();


    URL.revokeObjectURL(
      url
    );
  }


  // =========================================================
  // PRINT / PDF
  // =========================================================

  function printDashboard() {
    window.print();
  }


  // =========================================================
  // DARK MODE
  // =========================================================

  function applyTheme(
    theme
  ) {
    document.documentElement
      .setAttribute(
        'data-theme',
        theme
      );


    localStorage.setItem(
      'wtrba-theme',
      theme
    );


    const button =
      $('themeToggle');


    if (
      button
    ) {
      button.textContent =
        theme === 'dark'
          ? '☀ Light'
          : '☾ Dark';
    }
  }


  function initTheme() {
    const saved =
      localStorage.getItem(
        'wtrba-theme'
      );


    const systemDark =
      window.matchMedia &&
      window.matchMedia(
        '(prefers-color-scheme: dark)'
      ).matches;


    applyTheme(
      saved ||
        (
          systemDark
            ? 'dark'
            : 'light'
        )
    );


    $('themeToggle')
      ?.addEventListener(
        'click',
        () => {
          const current =
            document.documentElement
              .getAttribute(
                'data-theme'
              );


          applyTheme(
            current ===
              'dark'
              ? 'light'
              : 'dark'
          );
        }
      );
  }


  // =========================================================
  // LOAD ACTIVE STATION
  // =========================================================

  async function loadActiveStation() {
    if (
      !activeStation
    ) {
      return;
    }


    setError('');


    $('stationName')
      .textContent =
      activeStation.name;


    $('stationDescription')
      .textContent =
      'Loading live data…';


    try {
      const [
        waterPayload,
        batteryPayload
      ] =
        await Promise.all([
          fetchStationData(
            activeStation,
            'water',
            activeRange
          ),

          fetchStationData(
            activeStation,
            'battery',
            activeRange
          )
        ]);


      waterSeries =
        parseSeries(
          waterPayload
        );


      batterySeries =
        parseSeries(
          batteryPayload,
          activeStation
            .battery
            .multiplier ??
            1
        );


      renderMetrics();

      renderChart();


      const latestWater =
        lastValid(
          waterSeries
        );


      stationSnapshots.set(
        activeStation.id,
        {
          reading:
            latestWater,

          status:
            getStatus(
              activeStation,
              latestWater
            )
        }
      );


      renderStationList();


      $('lastRefresh')
        .textContent =
        `Refreshed ${
          new Intl.DateTimeFormat(
            'en-US',
            {
              hour:
                'numeric',

              minute:
                '2-digit',

              second:
                '2-digit'
            }
          ).format(
            new Date()
          )
        }`;

    } catch (error) {
      console.error(
        error
      );


      waterSeries = [];
      batterySeries = [];


      renderMetrics();

      renderChart();


      setError(
        'Live data could not be loaded from the WTRBA stream-data proxy.'
      );
    }
  }


  // =========================================================
  // RANGE CONTROLS
  // =========================================================

  function initRangeControls() {
    document
      .querySelectorAll(
        '.range-button[data-range]'
      )
      .forEach(
        (button) => {
          button.addEventListener(
            'click',
            () => {
              activeRange =
                button
                  .dataset
                  .range;


              document
                .querySelectorAll(
                  '.range-button[data-range]'
                )
                .forEach(
                  (rangeButton) =>
                    rangeButton
                      .classList
                      .toggle(
                        'active',
                        rangeButton ===
                          button
                      )
                );


              loadActiveStation();
            }
          );
        }
      );
  }


  // =========================================================
  // EVENT LISTENERS
  // =========================================================

  $('refreshBtn')
    ?.addEventListener(
      'click',
      () => {
        loadActiveStation();

        loadStationSnapshots();
      }
    );


  $('exportCsvBtn')
    ?.addEventListener(
      'click',
      exportCsv
    );


  $('printBtn')
    ?.addEventListener(
      'click',
      printDashboard
    );


  // =========================================================
  // INITIALIZATION
  // =========================================================

  initTheme();

  initRangeControls();

  renderStationList();

  loadStationSnapshots();


  if (
    activeStation
  ) {
    loadActiveStation();
  }

})();