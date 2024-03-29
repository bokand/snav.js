// TODO: Update interest ring when the interested element moves (e.g. due to
//       layout or an animation).
// TODO: Enable visibility testing on the intersection observer. It currently
//       doesn't work because our "interest ring" is an element we place over
//       top of the interested element. To the intersection observer, this
//       makes it look like it's always obscured.
// TODO: Make the interest ring work correctly under zoom (i.e. if the user
//       zooms way in on a large interested element the ring might not be
//       visible at all). It should probably be bounded by the visual viewport.
// TODO: Make video controls work. This might require mucking with shadow DOM
//       and I'm not entirely sure how this might be done. Might require help
//       from the page or the video player.
// TODO: Doesn't work inside IFRAMEs yet.

// Usage: Call snavInit() to setup spatial-navigation for the page. That's it!
//
//
// Terminology:
//
// Interest: Similar to focus, this is the element the user is currently
//           looking at/interacting with. We say such an element is the
//           "interested element" or "has interest". We draw a blue ring around
//           the current interested element. We currently apply focus when an
//           element becomes interested but that's a choice the framework can
//           change.
//
// Navigable Element: Things like buttons, links, etc. that the user should be
//                    able to apply interest to.
//
// Visible Elements: How it sounds: this is a set of all elements the framework
//                   considers "visible". When we navigate interest, we
//                   consider only these elements.
//
// This script sets up a bare-bones spatial-navigation implementation on the
// page. The way this works is we setup a mutation observer to watch for
// elements being added and removed from the DOM. When an element is added, we
// check if it is navigable (i.e. is it clickable/a button/has the "navigable"
// class) and if it is, we add it to the set of navigableElements. This allows
// us to scan this set rather than walking the entire DOM tree every time a key
// is pressed, on the assumption that the number of navigable elements will be
// a small fraction of the total elements in the DOM.
//
// As a further optimization, we add an intersection observer to the viewport.
// The observer watches all navigable elements and informs us when one
// enters/leaves the viewport at which point we update the visibleElements set.
// This further pares down the navigableElements to a small set of elements
// that we need to check when the user presses an arrow key.
function snavInit() {
  window.snav = {
    // The element that draws the interest ring.
    interestRing: null,

    // Which element currently has interest.
    interestedElement: null,

    // State for the intersection observer. An intersection observer is registered for the viewport and notifies us whenever a navigable
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
      // When true, adds an outline style to all elements in the visible set
      // for debugging.
      debugHighlightOnscreenTargets: false,

      // If true, the intersection obeserver that adds nodes to the "currently
      // visible" set will also test for overlap (i.e. can the user actually
      // see the node) from other nodes when considering whether a node is
      // "visible".
      // TODO: Clashes with the interest ring (assumes we're invisible because
      // the ring is above us).
      testVisibility: false,
    },
  };

  createInterestRing();
  registerMutationObserver();
  registerListeners();
  registerIntersectionObserver();

  // Do an initial seed of the navigable set. This might be slow? It should be
  // measured on a bad page. Dynamic changes will be tracked using the mutation
  // observer.
  document.querySelectorAll('*').forEach((node) => {
    if (isNavigable(node))
      addNavigableElement(node);
  });
}

function isScroller(node) {
  if (!node)
    return false;

  if (node == document)
    return true;

  const overflowX = node.computedStyleMap().get('overflow-x');
  const overflowY = node.computedStyleMap().get('overflow-y');

  if (overflowX == 'scroll' || overflowY == 'scroll')
    return true;

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

// Used to determine if a given node should be able to have interest move to
// it. Modify this with conditions to allow more elements to become interested.
function isNavigable(node) {
  if (node.type && node.type.toUpperCase() === 'HIDDEN')
    return false;

  if (node.tagName === 'A' ||
      node.tagName === 'BUTTON' ||
      node.tagName === 'VIDEO' ||
      node.tagName === 'INPUT')
    return true;

  // A page can make any element navigable by adding this class to it.
  if (node.classList.contains('navigable'))
    return true;

  const role = node.getAttribute('role');
  if (role && role.toUpperCase() === 'BUTTON')
    return true;

  if (isScroller(node))
    return true;

  return false;

}

function createInterestRing() {
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
  e.id = "snavInterestRing";
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

function getContainerFor(node) {
  if (!node || node == document)
    return document;

  let n = node.parentNode;

  while(n) {
    if (isScroller(n))
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
  if (!isScroller(container)) {
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
  let container = isScroller(searchOrigin)
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
  if (next)
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

// Sizes/styles the interest ring according to the currently interested node.
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

  // TODO: This should account for the zoom by using visual viewport.
  const width = Math.min(rect.width + margin,
                       window.innerWidth - border * 2);
  const height = Math.min(rect.height + margin,
                        window.innerHeight - border * 2);
  const x = Math.max(rect.x - border - margin/2, 0);
  const y = Math.max(rect.top - border - margin/2, 0);

  ring.style.width = width + "px";
  ring.style.height = height + "px";
  ring.style.left = x + "px";
  ring.style.top = y + "px";
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

function registerMutationObserver() {
  // Listen to any node additions and removals under the body and add/remove
  // the changes from the navigable set.
  const callback = (mutationsList, observer) => {
    for(let mutation of mutationsList) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType != Node.ELEMENT_NODE)
            return;

          // For debugging.
          //if (!snav.interestRing || node.id != snav.interestRing.id) {
          //  console.log('Added: ' + node.tagName + '[' + node.id + ']');
          //}

          if (isNavigable(node))
            addNavigableElement(node);
        });
        mutation.removedNodes.forEach((node) => {
          removeNavigableElement(node);
        });
      }
    }
  };
  const observer = new MutationObserver(callback);
  observer.observe(document.body, { attributes: false, childList: true, subtree: true });
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

      // For Debugging.
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
  if (ix == -1)
    return;

  snav.navigableElements.splice(ix, 1);
  snav.observer.unobserve(elem);
}
