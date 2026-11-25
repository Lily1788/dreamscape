const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const pet = document.querySelector('#pet');
const sprite = document.querySelector('#sprite');
const profile = document.querySelector('#profile');

pet.addEventListener('click', () => profile.showModal());
profile.querySelector('.close').addEventListener('click', () => profile.close());
profile.addEventListener('click', event => {
  if (event.target !== profile) return;
  const rect = profile.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom) profile.close();
});

const frames = [
  { id: 27, duration: 950, movement: [0, -9, 0] },
  { id: 28, duration: 820, movement: [0, -4, 0] },
  { id: 29, duration: 900, movement: [-14, -23, 0] },
  { id: 25, duration: 850, movement: [0, -5, 0] }
];
const idle = 'assets/lily-26.webp';
const poses = frames.map(frame => {
  const image = new Image();
  image.src = `assets/lily-${frame.id}.webp`;
  return { ...frame, image };
});
let poseIndex = 0;
let heroVisible = true;
new IntersectionObserver(([entry]) => {
  heroVisible = entry.isIntersecting;
}).observe(pet);
setInterval(() => {
  if (reducedMotion.matches || !heroVisible || document.hidden || profile.open) return;
  const pose = poses[poseIndex];
  poseIndex = (poseIndex + 1) % poses.length;
  if (!pose.image.complete || !pose.image.naturalWidth) return;
  sprite.src = pose.image.src;
  sprite.animate(pose.movement.map(y => ({ transform: `translateY(${y}px)` })),
    { duration: pose.duration, easing: 'ease-in-out' });
  setTimeout(() => { sprite.src = idle; }, pose.duration);
}, 3200);

const sceneObserver = new IntersectionObserver(entries => {
  for (const entry of entries) entry.target.classList.toggle('visible', entry.isIntersecting);
}, { threshold: .16 });
document.querySelectorAll('.scene').forEach(scene => sceneObserver.observe(scene));
document.body.classList.add('animated');

const tabs = document.querySelectorAll('.tabs button');
tabs.forEach(button => button.addEventListener('click', () => {
  tabs.forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)));
}));

const gallery = document.querySelector('#gallery');
const galleryImage = gallery.querySelector('img');
const galleryCaption = gallery.querySelector('p');

document.querySelectorAll('.shot').forEach(link => {
  link.addEventListener('click', event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const label = link.querySelector('img').alt;
    galleryImage.src = link.href;
    galleryImage.alt = label;
    galleryCaption.textContent = label;
    gallery.showModal();
  });
});
gallery.querySelector('.close').addEventListener('click', () => gallery.close());
gallery.addEventListener('click', event => {
  if (event.target === gallery) gallery.close();
});
