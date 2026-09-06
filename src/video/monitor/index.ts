/**
 * Camera monitor control-plane (MIoT SIID 10001): the autonomous cold-start
 * lifecycle plus the reversed action/property maps and pure wire helpers.
 */
export {
  MONITOR_SIID,
  MONITOR_AIID,
  MONITOR_PIID,
  MONITOR_VENDOR_TOKEN,
  FILL_LIGHT_MIN,
  VACUUM_SIID,
  VACUUM_MOVE,
  VACUUM_CHARGE,
  VACUUM_LOCATE,
  VACUUM_ACTIONS,
  VOICE_SIID,
  VOICE_PLAY_SOUND_AIID,
  VOICE_SOUND_PIID,
  PET_SOUNDS,
  type PetSound,
  type VacuumActionKey,
} from './constants.js';
export {
  parsePersonFollow,
  parseObstacleData,
  type DetectionBox,
  type PersonFollowDetection,
  type ObstacleDetection,
} from './detections.js';
export {
  makeMonitorSession,
  hashAccessCode,
  buildActionInput,
  startMonitorParams,
  stopMonitorParams,
  keepAliveParams,
  accessCodeLaunchParams,
  verifyAccessCodeParams,
  intercomStartParams,
  intercomStopParams,
  fillLightParams,
  takePhotoParams,
  remoteDriveValue,
  DRIVE_DIRECTIONS,
  actionCode,
  firstOutValue,
  type MonitorActionInput,
  type MonitorActionResult,
  type DriveDirection,
} from './protocol.js';
export {
  DreameCameraController,
  type DreameCameraControllerInput,
  type CameraStreamHandle,
  type MonitorActionCaller,
  type RelayMinter,
} from './controller.js';
