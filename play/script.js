import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Sky } from 'three/addons/objects/Sky.js';

const objects = [];

let Camera, Scene, renderer, stats, controls;
let plane;
let pointer, raycaster, isShiftDown = false;
let cubeGeo, cubeMaterial;
let sky, sun;

// --- PHYSICS & MOVEMENT STATE ---
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let canJump = false, flying = false;
let isCrouching = false, isClimbing = false;
let prevTime = performance.now();
let lastSpaceTime = 0;
let flyUp = false, flyDown = false;
let isSprinting = false;

// ─── PHYSICS CONSTANTS ────────────────────────────
const PLAYER_HEIGHT = 75;        // standard player height (1.5 blocks)
const CROUCH_HEIGHT = 55;        // crouched player height (1.1 blocks)
const PLAYER_WIDTH = 30;         // player collision width (0.6 blocks)
const GRAVITY = 9.8 * 100;       // units/s² (Minecraft-like gravity)
const JUMP_VELOCITY = 350;       // units/s (≈1.25 blocks high)
const WALK_SPEED = 4.317 * 50;   // ≈215 units/s (4.317 bps - Minecraft walk speed)
const SPRINT_SPEED = 5.612 * 50; // ≈281 units/s (5.612 bps - Minecraft sprint speed)
const CROUCH_SPEED = 1.31 * 50;  // ≈65 units/s (1.31 bps - Minecraft crouch speed)
const CLIMB_SPEED = 2.0 * 50;    // ≈100 units/s (2.0 bps - Minecraft ladder climb speed)
const FLY_SPEED = 600;           // horizontal flight speed (Minecraft creative)
const CLIMB_FLY_SPEED = 300;     // vertical flight speed (Minecraft creative)
const AIR_RESISTANCE = 0.02;     // air resistance (slows horizontal movement in air)
const GROUND_FRICTION = 0.1;     // ground friction (quick stop on ground)

// Climbing state
let touchingLadder = false;      // whether player is touching a ladder
let touchingWater = false;       // whether player is in water

const listener = new THREE.AudioListener();
const sound_bg = new THREE.Audio(listener);
const sound_break = new THREE.Audio(listener);
const sound_create = new THREE.Audio(listener);
const sound_step = new THREE.Audio(listener);
const sound_jump = new THREE.Audio(listener);

const GAME_STATE = {
    MENU: "MENU",
    PLAYING: "PLAYING"
}

const TEXTURES = {
    GRASS: null,
    BRICK: null,
    BRICK_B: null,
    GLASS: null,
    SAND: null,
    WATER: null,
    LADDER: null,
}

let GAME_STATUS = GAME_STATE.MENU;

const init = () => {

    stats = new Stats();
    document.body.appendChild(stats.dom);

    Camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 10000);
    Camera.position.set(500, 800, 1300);
    Camera.lookAt(0, 0, 0);

    Scene = new THREE.Scene();
    Scene.background = new THREE.Color(0xf0f0f0);

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();

    const geometry = new THREE.PlaneGeometry(4000, 4000);
    geometry.rotateX(- Math.PI / 2);

    const texture = new THREE.TextureLoader().load('textures/grass_plane.jpg');
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(80, 80);

    plane = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ map: texture }));
    Scene.add(plane);

    objects.push(plane);

    const ambientLight = new THREE.AmbientLight(0x606060);
    Scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(1, 0.75, 0.5).normalize();
    Scene.add(directionalLight);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    controls = new PointerLockControls(Camera, renderer.domElement);
    Scene.add(controls.getObject());
    controls.getObject().position.y = PLAYER_HEIGHT;  // start on the ground
    prevTime = performance.now();                     // kick off your physics timer
    Scene.add(controls.getObject());

    // Click to lock pointer (enter game)
    document.getElementById('blocker').addEventListener('click', () => {
        controls.lock();
    });

    // Lock/unlock state change listener
    controls.addEventListener('lock', () => {
        gamePlay();
    });

    controls.addEventListener('unlock', () => {
        gamePaused();
    });

    // KEYBOARD HANDLERS
    const onKeyDown = (event) => {
        if (GAME_STATUS !== GAME_STATE.PLAYING) return;

        switch (event.code) {
            case 'ArrowUp':
            case 'KeyW':
                moveForward = true;
                break;
            case 'ArrowLeft':
            case 'KeyA':
                moveLeft = true;
                break;
            case 'ArrowDown':
            case 'KeyS':
                moveBackward = true;
                break;
            case 'ArrowRight':
            case 'KeyD':
                moveRight = true;
                break;
            case 'Space':
                {
                    const now = performance.now();
                    if (now - lastSpaceTime < 300) {
                        // ❄️ Double‑tap → toggle flying 
                        const wasFlying = flying;
                        flying = !flying;

                        if (flying) {
                            playSound('flight_start');
                            // When starting to fly, zero out vertical velocity
                            velocity.y = 0;
                        } else if (wasFlying) {
                            // When stopping flight, reset vertical velocity and fall
                            velocity.y = 0;
                            canJump = false; // Force gravity to take effect
                        }

                        flyUp = flyDown = false;
                    } else if (flying) {
                        // 🪂 start climbing in fly mode
                        flyUp = true;
                    } else if (canJump) {
                        // 🔼 normal jump 
                        velocity.y += JUMP_VELOCITY;
                        canJump = false;
                        playSound('jump');
                    } else if (isClimbing) {
                        // Climb up ladder
                        velocity.y = CLIMB_SPEED;
                    } else if (touchingWater) {
                        // Swim up
                        velocity.y = CLIMB_SPEED * 0.8;
                    }
                    lastSpaceTime = now;
                }
                break;
            case 'ControlLeft':
            case 'ControlRight':
                if (flying) {
                    // 🤿 start descending in fly mode
                    flyDown = true;
                }
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                if (!isCrouching && canJump && !flying) {
                    // Only sprint when on ground
                    isSprinting = true;
                    playSound('step');
                }
                isShiftDown = true;
                break;
            case 'KeyC':
                toggleCrouch();
                break;
        }
    };

    const onKeyUp = (event) => {
        if (GAME_STATUS !== GAME_STATE.PLAYING) return;

        switch (event.code) {
            case 'ArrowUp':
            case 'KeyW':
                moveForward = false;
                break;
            case 'ArrowLeft':
            case 'KeyA':
                moveLeft = false;
                break;
            case 'ArrowDown':
            case 'KeyS':
                moveBackward = false;
                break;
            case 'ArrowRight':
            case 'KeyD':
                moveRight = false;
                break;
            case 'Space':
                if (flying) flyUp = false;
                break;
            case 'ControlLeft':
            case 'ControlRight':
                flyDown = false;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                isSprinting = false;
                isShiftDown = false;
                break;
        }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    document.addEventListener('mouseenter', onPointerMove);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onDocumentKeyDown);
    document.addEventListener('keyup', onDocumentKeyUp);

    window.addEventListener('resize', onWindowResize);

    initSky();
    initTexture();

    const textures = document.querySelectorAll('.texture');

    textures.forEach((texture) => {
        texture.addEventListener('click', function () {
            document.querySelector('.texture.active').classList.remove('active');
            texture.classList.add('active');

            console.log(texture.getAttribute('data-texture'));
            cubeMaterial = eval(`TEXTURES.${texture.getAttribute('data-texture')}`);
            gamePlay();
        })
    });
}

// Toggle crouching state
const toggleCrouch = () => {
    if (flying) return; // Can't crouch while flying

    isCrouching = !isCrouching;

    if (isCrouching) {
        // Scale down camera for crouch effect
        controls.getObject().position.y -= (PLAYER_HEIGHT - CROUCH_HEIGHT);
        isSprinting = false; // Can't sprint while crouching
        playSound('crouch');
    } else {
        // Return to normal height (if there's space)
        const headPosition = controls.getObject().position.clone();
        headPosition.y += (PLAYER_HEIGHT - CROUCH_HEIGHT);

        // Check if we have room to stand up
        raycaster.set(controls.getObject().position, new THREE.Vector3(0, 1, 0));
        const intersects = raycaster.intersectObjects(objects, false);

        if (intersects.length === 0 || intersects[0].distance > (PLAYER_HEIGHT - CROUCH_HEIGHT)) {
            controls.getObject().position.y += (PLAYER_HEIGHT - CROUCH_HEIGHT);
        } else {
            // Can't stand up here - remain crouched
            isCrouching = true;
        }
    }
};

// Play sound effects
const playSound = (type) => {
    // Implement sound effects for different actions
    switch (type) {
        case 'step':
            if (sound_step.isPlaying) sound_step.stop();
            sound_step.play();
            break;
        case 'jump':
            if (sound_jump.isPlaying) sound_jump.stop();
            sound_jump.play();
            break;
        case 'crouch':
            // Add crouch sound if available
            break;
        case 'flight_start':
            // Add flight sound if available
            break;
    }
};

// Check if player is climbing (touching ladder)
const checkClimbing = () => {
    const playerPos = controls.getObject().position.clone();
    const directions = [
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 0, -1)
    ];

    touchingLadder = false;

    for (const dir of directions) {
        raycaster.set(playerPos, dir);
        const intersects = raycaster.intersectObjects(objects, false);

        if (intersects.length > 0 && intersects[0].distance < PLAYER_WIDTH) {
            const block = intersects[0].object;
            if (block.userData && block.userData.isLadder) {
                touchingLadder = true;
                break;
            }
        }
    }

    // If touching a ladder and the player is moving (or not perfectly aligned), consider them climbing.
    isClimbing = touchingLadder && (moveForward || moveBackward || moveLeft || moveRight || Math.abs(velocity.y) > 0.1);
    return isClimbing;
};

// Check if player is in water
const checkWater = () => {
    const playerPos = controls.getObject().position.clone();

    // Simple check if any water blocks are nearby
    // You'll need to tag water blocks with userData.isWater = true
    raycaster.set(playerPos, new THREE.Vector3(0, 0, 0));
    const intersects = raycaster.intersectObjects(objects, false);

    touchingWater = false;

    for (const intersect of intersects) {
        if (intersect.object.userData && intersect.object.userData.isWater) {
            touchingWater = true;
            break;
        }
    }

    return touchingWater;
};

const gamePaused = () => {
    const blocker = document.getElementById('blocker');
    const instructions = document.getElementById('instructions');

    document.body.style.cursor = 'unset';
    instructions.style.display = 'flex';
    blocker.style.display = 'block';
    GAME_STATUS = GAME_STATE.MENU;
}

const gamePlay = () => {
    const blocker = document.getElementById('blocker');
    const instructions = document.getElementById('instructions');

    instructions.style.display = 'none';
    blocker.style.display = 'none';
    GAME_STATUS = GAME_STATE.PLAYING;
    sound_bg.play();
}

const initTexture = () => {
    TEXTURES.GRASS = new THREE.MeshLambertMaterial({ transparent: true, map: new THREE.TextureLoader().load('textures/grass_block.jpg') });
    TEXTURES.BRICK = new THREE.MeshLambertMaterial({ transparent: true, map: new THREE.TextureLoader().load('textures/brick_block.jpg') });
    TEXTURES.BRICK_B = new THREE.MeshLambertMaterial({ transparent: true, map: new THREE.TextureLoader().load('textures/brick2_block.jpg') });
    TEXTURES.GLASS = new THREE.MeshLambertMaterial({ transparent: true, map: new THREE.TextureLoader().load('textures/glass_block.png') });
    TEXTURES.SAND = new THREE.MeshLambertMaterial({ transparent: true, map: new THREE.TextureLoader().load('textures/sand_block.jpg') });
    TEXTURES.WATER = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.7, map: new THREE.TextureLoader().load('textures/water.gif') });
    TEXTURES.LADDER = new THREE.MeshLambertMaterial({ transparent: true, map: new THREE.TextureLoader().load('textures/ladder.png') });

    cubeGeo = new THREE.BoxGeometry(50, 50, 50);
}

const initSky = () => {
    sky = new Sky();
    sky.scale.setScalar(450000);
    Scene.add(sky);

    sun = new THREE.Vector3();

    const effectController = {
        turbidity: 10,
        rayleigh: 3,
        mieCoefficient: 0.005,
        mieDirectionalG: 0.7,
        elevation: 10,
        azimuth: 180,
        exposure: renderer.toneMappingExposure
    };

    const uniforms = sky.material.uniforms;
    uniforms['turbidity'].value = effectController.turbidity;
    uniforms['rayleigh'].value = effectController.rayleigh;
    uniforms['mieCoefficient'].value = effectController.mieCoefficient;
    uniforms['mieDirectionalG'].value = effectController.mieDirectionalG;

    const phi = THREE.MathUtils.degToRad(90 - effectController.elevation);
    const theta = THREE.MathUtils.degToRad(effectController.azimuth);

    sun.setFromSphericalCoords(1, phi, theta);

    uniforms['sunPosition'].value.copy(sun);

    renderer.toneMappingExposure = effectController.exposure;
    renderer.render(Scene, Camera);
}

const onWindowResize = () => {
    Camera.aspect = window.innerWidth / window.innerHeight;
    Camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    controls.handleResize();
}

const onPointerMove = (event) => {
    pointer.set((event.clientX / window.innerWidth) * 2 - 1, - (event.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, Camera);
    const intersects = raycaster.intersectObjects(objects, false);

    if (intersects.length > 0) {
        const intersect = intersects[0];
        // Highlight block being looked at if needed
    }
}

const onPointerDown = (event) => {
    if (GAME_STATUS !== GAME_STATE.PLAYING) return;

    // If pointer is locked, always use the screen center.
    if (controls.isLocked) {
        pointer.set(0, 0);
    } else {
        pointer.set(
            (event.clientX / window.innerWidth) * 2 - 1,
            -(event.clientY / window.innerHeight) * 2 + 1
        );
    }

    raycaster.setFromCamera(pointer, Camera);
    const intersects = raycaster.intersectObjects(objects, false);

    if (intersects.length > 0) {
        const intersect = intersects[0];
        const targetBlock = intersect.object; // the block being clicked

        // When pressing SHIFT, break blocks. (Keep your existing logic)
        if (isShiftDown) {
            if (targetBlock !== plane) {
                if (sound_break.isPlaying) sound_break.stop();
                sound_break.play();
                Scene.remove(targetBlock);
                objects.splice(objects.indexOf(targetBlock), 1);
            }
        } else {
            // For ladder placement, do extra checks
            if (cubeMaterial === TEXTURES.LADDER) {
                // The ladder must be placed on the side of a block (not on the plane, water, or another ladder)
                if (!targetBlock || targetBlock === plane) {
                    console.log("Ladder must be placed on the side of a block!");
                    return;
                }
                if (targetBlock.userData && (targetBlock.userData.isLadder || targetBlock.userData.isWater)) {
                    console.log("Cannot place ladder on top of water or another ladder!");
                    return;
                }

                // Ensure that the face clicked is vertical (not top or bottom)
                const normal = intersect.face.normal;
                if (Math.abs(normal.y) > 0.1) {
                    console.log("Ladders must be placed on the side of a block, not on top!");
                    return;
                }

                // Instead of using the raw intersection point, snap to grid at the center of the block face.
                createLadder(intersect);
            } else {
                // Standard block placement for non-ladder types:
                const pos = intersect.point.clone().add(intersect.face.normal);
                pos.divideScalar(50).floor().multiplyScalar(50).addScalar(25);
                const voxel = new THREE.Mesh(cubeGeo, cubeMaterial);
                voxel.position.copy(pos);

                // For glass, add transparency metadata if needed
                if (cubeMaterial === TEXTURES.GLASS) {
                    voxel.userData = { isTransparent: true };
                }
                Scene.add(voxel);
                voxel.geometry.computeBoundingBox();
                voxel.userData.boundingBox = voxel.geometry.boundingBox.clone().applyMatrix4(voxel.matrixWorld);
                objects.push(voxel);
            }
        }
    }
};

const onDocumentKeyDown = (event) => {
    switch (event.keyCode) {
        case 16: isShiftDown = true; break;
    }
}

const onDocumentKeyUp = (event) => {
    switch (event.keyCode) {
        case 16: isShiftDown = false; break;
        case 27: GAME_STATUS === GAME_STATE.MENU ? gamePlay() : gamePaused(); break;
    }
}

// Collision detection for player movement
const checkCollisions = (moveDirection, moveDistance) => {
    const playerPos = controls.getObject().position.clone();
    const playerHeight = isCrouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;

    // Check collision in the movement direction
    raycaster.set(playerPos, moveDirection);
    const intersects = raycaster.intersectObjects(objects, false);

    if (intersects.length > 0 && intersects[0].distance < PLAYER_WIDTH + moveDistance) {
        // Collision detected, adjust move distance
        const obj = intersects[0].object;
        if (!obj.userData || !obj.userData.isTransparent) {
            return intersects[0].distance - PLAYER_WIDTH * 0.9;
        }
    }

    return moveDistance;
};

// Step climbing - try to go up small steps automatically
const attemptStepClimb = () => {
    if (flying || !canJump) return false;

    const playerPos = controls.getObject().position.clone();
    const moveDir = direction.clone().normalize();

    if (moveDir.length() === 0) return false;

    // Cast ray forward to detect steps
    raycaster.set(playerPos, moveDir);
    const intersects = raycaster.intersectObjects(objects, false);

    if (intersects.length > 0 && intersects[0].distance < PLAYER_WIDTH * 1.5) {
        // There's a block in front of us - check if we can step up
        const stepCheckPos = playerPos.clone();
        stepCheckPos.y += 25; // Half block height

        raycaster.set(stepCheckPos, moveDir);
        const stepIntersects = raycaster.intersectObjects(objects, false);

        if (stepIntersects.length === 0 || stepIntersects[0].distance > PLAYER_WIDTH * 1.5) {
            // We can step up
            controls.getObject().position.y += 25;
            return true;
        }
    }

    return false;
};

const render = () => {
    const time = performance.now();
    const delta = (time - prevTime) / 1000; // seconds

    // Check for climbing/water interaction
    checkClimbing();
    checkWater();

    // Calculate movement speed based on state
    let movementSpeed = WALK_SPEED;
    if (flying) {
        movementSpeed = FLY_SPEED;
    } else if (isSprinting && !isCrouching && canJump) {
        movementSpeed = SPRINT_SPEED;
    } else if (isCrouching) {
        movementSpeed = CROUCH_SPEED;
    } else if (isClimbing) {
        movementSpeed = CLIMB_SPEED;
    } else if (touchingWater) {
        movementSpeed = WALK_SPEED * 0.5; // Slower in water
    }

    // Apply appropriate physics based on movement state
    // Apply vertical movement
    if (!flying) {
        if (isClimbing) {
            // Ladder behavior: allow vertical climbing with minimal gravitational pull.
            // If the player is pressing a key (or in continuous contact), move upward at a fixed speed.
            if (moveForward || moveBackward || moveLeft || moveRight || flyUp) {
                velocity.y = CLIMB_SPEED;
            } else {
                // Hold position on the ladder when no vertical input is provided.
                velocity.y = 0;
            }
        } else if (touchingWater) {
            // Water behavior: apply reduced gravity and some buoyancy.
            // Apply a gentle upward force if the player's descending too fast.
            const buoyancyForce = GRAVITY * 0.2;
            if (velocity.y < -buoyancyForce) {
                velocity.y = -buoyancyForce;
            }
            // Continue applying reduced gravity to simulate water resistance.
            velocity.y -= (GRAVITY * 0.3) * delta;
        } else {
            // Normal gravity.
            velocity.y -= GRAVITY * delta;
        }

        // Update the player's vertical position.
        controls.getObject().position.y += velocity.y * delta;

        // Ground collision detection.
        const groundY = isCrouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
        if (controls.getObject().position.y <= groundY) {
            controls.getObject().position.y = groundY;
            velocity.y = 0;
            canJump = true;

            // Trigger stepping sounds if moving.
            if ((moveForward || moveBackward || moveLeft || moveRight) && Math.random() < delta * 5) {
                playSound('step');
            }
        }
    } else {
        // In flying mode, zero out gravity influences.
        velocity.set(0, 0, 0);
        if (flyUp) controls.getObject().position.y += CLIMB_FLY_SPEED * delta;
        if (flyDown) controls.getObject().position.y -= CLIMB_FLY_SPEED * delta;
    }

    // Movement input direction
    direction.x = Number(moveRight) - Number(moveLeft);
    direction.z = Number(moveForward) - Number(moveBackward);

    if (direction.length() > 0) {
        direction.normalize(); // Consistent speed in all directions

        if (flying) {
            // In flying mode - move in the direction you're looking
            const forwardDir = new THREE.Vector3();
            Camera.getWorldDirection(forwardDir);
            forwardDir.y = 0;
            forwardDir.normalize();

            const rightDir = new THREE.Vector3()
                .crossVectors(forwardDir, Camera.up)
                .normalize();

            const flyDir = new THREE.Vector3();
            if (moveForward) flyDir.add(forwardDir);
            if (moveBackward) flyDir.sub(forwardDir);
            if (moveRight) flyDir.add(rightDir);
            if (moveLeft) flyDir.sub(rightDir);

            if (flyDir.length() > 0) {
                flyDir.normalize();
                const moveDistance = movementSpeed * delta;
                controls.getObject().position.addScaledVector(flyDir, moveDistance);
            }
        } else {
            // Regular movement with collision detection
            const moveDistance = movementSpeed * delta;

            // Try stepping up small blocks (Minecraft-like behavior)
            if (!isCrouching && canJump) {
                attemptStepClimb();
            }

            // Apply collision detection
            let actualForwardDist = checkCollisions(
                new THREE.Vector3(0, 0, direction.z).normalize(),
                Math.abs(direction.z * moveDistance)
            );
            let actualRightDist = checkCollisions(
                new THREE.Vector3(direction.x, 0, 0).normalize(),
                Math.abs(direction.x * moveDistance)
            );

            // Move with collision constraints
            if (direction.z !== 0) {
                controls.moveForward(Math.sign(direction.z) * actualForwardDist);
            }
            if (direction.x !== 0) {
                controls.moveRight(Math.sign(direction.x) * actualRightDist);
            }
        }
    }

    prevTime = time;
    requestAnimationFrame(render);
    stats.update();
    if (GAME_STATUS === GAME_STATE.PLAYING) {
        renderer.render(Scene, Camera);
    }
};

const addAudio = () => {
    Camera.add(listener);
    const audioLoader = new THREE.AudioLoader();

    // Background ambient sound
    audioLoader.load('sounds/birds.mp3', function (buffer) {
        sound_bg.setBuffer(buffer);
        sound_bg.setLoop(true);
        sound_bg.setVolume(0.3);
    });

    // Block breaking sound
    audioLoader.load('sounds/break.ogg', function (buffer) {
        sound_break.setBuffer(buffer);
        sound_break.setVolume(1);
    });

    // Block placing sound
    audioLoader.load('sounds/create.ogg', function (buffer) {
        sound_create.setBuffer(buffer);
        sound_create.setVolume(1);
    });

    // Add footstep sound using step.mp3 instead of step.ogg
    audioLoader.load('sounds/step.mp3', function (buffer) {
        sound_step.setBuffer(buffer);
        sound_step.setVolume(0.5);
    });

    // Add jump sound using jump.mp3 instead of jump.ogg
    audioLoader.load('sounds/jump.mp3', function (buffer) {
        sound_jump.setBuffer(buffer);
        sound_jump.setVolume(0.7);
    });
};

// Create special blocks with metadata
const createSpecialBlock = (type, position) => {
    let material, mesh;
    const userData = {};

    switch (type) {
        case 'ladder': {
            // Create a ladder as a thin plane rather than a cube.
            // A ladder in Minecraft is just a flat texture that “sticks” to a wall.
            const ladderGeo = new THREE.PlaneGeometry(50, 50);
            material = new THREE.MeshLambertMaterial({
                transparent: true,
                side: THREE.DoubleSide, // Ensures it can be seen from either side.
                map: new THREE.TextureLoader().load('textures/ladder.png')
            });
            userData.isLadder = true;
            // Create the ladder mesh.
            mesh = new THREE.Mesh(ladderGeo, material);

            // Position the ladder on the block grid.
            // Adjust its position so that it sticks to a side.
            // Here we shift it slightly along the Z-axis (you can adjust based on desired orientation).
            mesh.position.copy(position);
            mesh.position.z += 25; // Offset by half the block size.

            // Rotate the ladder so that it faces the player by default.
            // Here, the plane originally faces +Z. Since we offset along +Z, rotate 180° around Y to face -Z.
            mesh.rotation.y = Math.PI;
            break;
        }
        case 'water': {
            // For water, we use a VideoTexture to simulate flowing animation.
            // Animated GIF files are not automatically animated in Three.js.
            // It is recommended to convert your water animation (if it’s a gif) to a video format (e.g., water.mp4).
            const video = document.createElement('video');
            video.src = 'textures/water.mp4'; // Use a video file (or webm) here.
            video.loop = true;
            video.muted = true;
            video.play();

            const waterTexture = new THREE.VideoTexture(video);
            waterTexture.minFilter = THREE.LinearFilter;
            waterTexture.magFilter = THREE.LinearFilter;
            waterTexture.format = THREE.RGBFormat;

            material = new THREE.MeshLambertMaterial({
                transparent: true,
                opacity: 0.7,
                map: waterTexture
            });
            userData.isWater = true;
            // Water will keep its normal cube geometry.
            mesh = new THREE.Mesh(cubeGeo, material);
            mesh.position.copy(position);
            break;
        }
        default:
            return null;
    }

    mesh.userData = userData;
    Scene.add(mesh);
    objects.push(mesh);
    return mesh;
};

function createLadder(intersect) {
    // Create a thin plane for the ladder
    const ladderGeo = new THREE.PlaneGeometry(50, 50);
    const ladderMaterial = new THREE.MeshLambertMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        map: new THREE.TextureLoader().load('textures/ladder.png')
    });
    const ladder = new THREE.Mesh(ladderGeo, ladderMaterial);

    // Compute the block's center based on the grid.
    // We take the intersected block's position, round it to the nearest grid, then add half block size.
    const blockPos = intersect.object.position.clone();
    blockPos.divideScalar(50).floor().multiplyScalar(50).addScalar(25);

    // Determine the center of the face that was clicked.
    // For instance, if the ladder is on the right side of the block (normal is (1,0,0)),
    // then we place the ladder at the center of that face.
    const faceCenter = blockPos.clone();
    // Use the face normal to offset the ladder outward:
    faceCenter.addScaledVector(intersect.face.normal, 25);

    ladder.position.copy(faceCenter);

    // Align the ladder with the face by computing the angle around Y from the normal.
    const angle = Math.atan2(intersect.face.normal.x, intersect.face.normal.z);
    ladder.rotation.y = angle;

    // Mark it as a ladder
    ladder.userData.isLadder = true;

    Scene.add(ladder);
    objects.push(ladder);
}

init();
addAudio();
render();