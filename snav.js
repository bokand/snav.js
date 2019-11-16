function snavInit() {
  window.snav = {
    // The element that draws the interest ring.
    interestRing: null,

    // Which element currently has interest.
    interestedElement: null,


    observer: null,
    observerCallback: null,

    // All elements in the DOM that we should be considering for navigation.
    navigableElements: [],

    // Navigable elements that are currently visible on screen.
    visibleElements: [],

    dir: {
      UP: 1,
      RIGHT: 2,
      DOWN: 3,
      LEFT: 4,
    },

    flags: {
      debugHighlightOnscreenTargets: false,

      // Clashes with the interest ring (assumes we're invisible because the ring is above us).
      testVisibility: false,
    },
  };

  createInterest();
  registerListeners();
  registerIntersectionObserver();
  enumerateNavigables();
}

function isScroller(node) {
  const overflowX = node.computedStyleMap().get('overflow-x');
  const overflowY = node.computedStyleMap().get('overflow-y');

  if ((overflowX != 'visible' && overflowX != 'hidden')) {
    if (node.scrollWidth > node.clientWidth)
      return true;
  }

  if ((overflowY != 'visible' && overflowY != 'hidden')) {
    if (node.scrollHeight > node.clientHeight)
      return true;
  }

  return false;
}

function enumerateNavigables() {
  document.querySelectorAll('*').forEach((node) => {
    if (node.tagName === 'A' ||
        node.classList.contains('navigable') ||
        isScroller(node))
      addNavigableElement(node);
  });
}

function createInterest() {
  let e = document.createElement('div');
  e.style.width = "50px";
  e.style.height = "50px";
  e.style.position = "absolute";
  e.style.left = "20px";
  e.style.top = "20px";
  e.style.zIndex = "10000";
  e.style.border = "solid 3px dodgerblue";
  e.style.borderRadius = "5px";
  e.style.visibility = "hidden";
  snav.interestRing = e;

  document.body.appendChild(snav.interestRing);
}

function keyUpHandler(e) {
  e.preventDefault();
}

function keyToDir(key) {
  if (key == "ArrowUp")
    return snav.dir.UP;
  if (key == "ArrowRight")
    return snav.dir.RIGHT;
  if (key == "ArrowDown")
    return snav.dir.DOWN;
  if (key == "ArrowLeft")
    return snav.dir.LEFT;

  return null;
}

function getTestingPoint(dir, rect) {
  let pt = new DOMPoint(0, 0);
  if (dir == snav.dir.UP || dir == snav.dir.DOWN) {
    pt.x = rect.left + rect.width / 2;
    if (dir == snav.dir.UP)
      pt.y = rect.bottom;
    else
      pt.y = rect.top;
  } else {
    pt.y = rect.top + rect.height / 2;
    if (dir == snav.dir.RIGHT)
      pt.x = rect.left
    else
      pt.x = rect.right;
  }

  return pt;
}

function isContainer(node) {
  //TODO: allow authors to specify containers manually using some attribute?
  if (!node)
    return false;

  if (node == document)
    return true;

  const style = node.computedStyleMap();
  const overflowX = style.get('overflow-x').value;
  const overflowY = style.get('overflow-y').value;

  if ((overflowX == 'visible' || overflowX == 'hidden') &&
      (overflowY == 'visible' || overflowY == 'hidden'))
    return false;

  if (overflowX == 'scroll' || overflowY == 'scroll')
    return true;

  if (overflowY == 'auto') {
    if (node.scrollHeight > node.clientHeight)
      return true;
  }

  if (overflowX == 'auto') {
    if (node.scrollWidth > node.clientWidth)
      return true;
  }

  return false;
}

function getContainerFor(node) {
  if (!node || node == document)
    return document;

  let n = node.parentNode;

  while(n) {
    if (isContainer(n))
      return n;

    n = n.parentNode;
    // TODO make work across iframes
  }

  return document;
}

function filterToCurrentContainer(elementList, container) {
  let retList = [];
  for (let e of elementList) {
    if (getContainerFor(e) == container)
      retList.push(e);
  }

  return retList;
}

function getElementsInDirection(point, dir) {
  let ret = [];
  for(let e of snav.visibleElements) {
    const rect = e.getBoundingClientRect();
    if (dir == snav.dir.UP && rect.bottom < point.y ||
        dir == snav.dir.RIGHT && rect.left > point.x ||
        dir == snav.dir.DOWN && rect.top > point.y ||
        dir == snav.dir.LEFT && rect.right < point.x) {
      ret.push(e);
    }
  }
  return ret;
}

function distanceSq(a, b) {
  dx = b.x - a.x;
  dy = b.y - a.y;
  return dx*dx + dy*dy;
}

function findClosestWithinContainer(searchOrigin, dir, container) {
  let curRect = searchOrigin
      ? searchOrigin.getBoundingClientRect()
      : new DOMRect(0, 0, window.innerWidth, window.innerHeight);

  let startingPoint = getTestingPoint(dir, curRect);
  let elementsInDir = getElementsInDirection(startingPoint, dir);

  const candidateElements = filterToCurrentContainer(elementsInDir, container);

  let minDistSq = Infinity;
  let bestCandidate = null;
  for (let candidate of candidateElements) {
    let candidatePt = getTestingPoint(dir, candidate.getBoundingClientRect());
    let distSq = distanceSq(startingPoint, candidatePt);
    if (distSq < minDistSq) {
      minDistSq = distSq;
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
}

function canScroll(container, dir) {
  if (!isContainer(container)) {
    console.error("Called canScroll on non container!");
    return false;
  }

  if (dir == snav.dir.UP)
    return container.scrollTop > 0;
  if (dir == snav.dir.DOWN)
    return container.scrollTop < (container.scrollHeight - container.clientHeight - 1);
  if (dir == snav.dir.LEFT)
    return container.scrollLeft > 0;
  if (dir == snav.dir.RIGHT)
    return container.scrollLeft < (container.scrollWidth - container.clientWidth - 1);

  console.error("Bad Direction");
  return false;
}

function findClosest(dir) {
  const searchOrigin = snav.interestedElement;
  let container = isContainer(searchOrigin)
      ? searchOrigin
      : getContainerFor(searchOrigin);

  while (true) {
    let bestCandidate = findClosestWithinContainer(searchOrigin, dir, container);
    if (bestCandidate)
      return bestCandidate;

    if (canScroll(container, dir)) {
      // Return null so we allow the key event to scroll.
      return null;
    }

    if (container  == document)
      break;

    container = getContainerFor(container);
  };

  return null;
}

// Returns true of interest was moved, false otherwise.
function advance(dir) {
  let nextElement = findClosest(dir);

  if (nextElement == null)
    return false;

  moveInterestTo(nextElement);
  return true;
}

function moveInterestTo(next) {
  next.focus();

  snav.interestedElement = next;
  refreshInterestRing();
}

function toPageCoordinates(clientRect) {
  let pageRect = clientRect;
  pageRect.x += window.scrollX;
  pageRect.y += window.scrollY;
  return pageRect;
}

function isFixed(elem) {
  let e = elem;
  while (e) {
    const style = getComputedStyle(e);
    if (style.position == "fixed")
      return true;

    e = e.offsetParent;
  }

  return false;
}

function getContainerRelativeRect(e) {
  const rect = e.getBoundingClientRect(e);
  const container = getContainerFor(e);
  if (!container.parentNode)
    return rect;

  // TODO This needs to be more general.
  rect.x = e.offsetLeft;
  rect.y = e.offsetTop;
  return rect;
}

function refreshInterestRing() {
  const e = snav.interestedElement;
  const ring = snav.interestRing;

  if (e == null) {
    ring.style.visibility = "hidden";
    return;
  }

  ring.remove();
  const container = getContainerFor(e);
  if (!container.parentNode)
    container.body.appendChild(ring);
  else
    container.appendChild(ring);

  let rect = getContainerRelativeRect(e);

  if (isFixed(e)) {
    ring.style.position = "fixed";
  } else {
    ring.style.position = "absolute";
    if (!container.parentNode)
      rect = toPageCoordinates(rect);
  }

  const margin = 6;
  const border = 3;
  ring.style.width = rect.width + margin + "px";
  ring.style.height = rect.height + margin + "px";
  ring.style.left = rect.x - border - margin/2 + "px";
  ring.style.top = rect.top - border - margin/2 + "px";
  ring.style.visibility = "visible";
}

function keyDownHandler(e) {
  const dir = keyToDir(e.key);
  if (dir) {
    if (advance(dir))
      e.preventDefault();
  }

  if (e.key == "Enter") {
    if (snav.interestedElement != null) {
      snav.interestedElement.focus();
      snav.interestedElement.click();
    }
  } else if (e.key == "Escape") {
    if (snav.interestedElement != null && document.activeElement == snav.interestedElement)
      snav.interestedElement.blur();
  }
}

function registerListeners() {
  addEventListener("keydown", keyDownHandler);
  addEventListener("keyup", keyUpHandler);
}

function printVisibles() {
  console.log("====VisibleElements");
  for (let e of snav.visibleElements) {
    console.log("\t" + e + " id[" + e.id + "]");
  }
}

function updateVisibleElements(entry) {
  const ix = snav.visibleElements.indexOf(entry.target);
  if (entry.isIntersecting && (!snav.flags.testVisibility || entry.isVisible)) {
    if (ix == -1) {
      snav.visibleElements.push(entry.target);
    }
  } else {
    if (ix !== -1) {
      snav.visibleElements.splice(ix, 1);
    }

    if (entry.target == snav.interestedElement)
      moveInterestTo(null);
  }
}

function observerCallback(entries, observer) {
  entries.forEach(entry => {
    if (snav.flags.debugHighlightOnscreenTargets) {
      if (entry.isIntersecting)
        entry.target.style.outline = "thick double red";
      else
        entry.target.style.outline = "";

      //printVisibles();
    }

    updateVisibleElements(entry);
  });
}

function registerIntersectionObserver() {
  let options = {
    root: null,
    rootMargin: "0px",
    threshold: [0.01],
    trackVisibility: snav.flags.testVisibility,
    delay: 100,
  }

  snav.observer = new IntersectionObserver(observerCallback, options);
}

function addNavigableElement(elem) {
  snav.navigableElements.push(elem);
  snav.observer.observe(elem);
}

function removeNavigableElement(elem) {
  const ix = snav.navigableElements.indexOf(elem);
  // assert ix !== -1
  snav.navigableElements.splice(ix, 1);
  snav.observer.unobserve(elem);
}
