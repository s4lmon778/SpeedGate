import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanRoute, lanAddress } from '../lib/bridge/lan-route';

afterEach(() => vi.useRealTimers());
const host =
  'a=candidate:42 1 udp 2122260223 hidden-device.local 50987 typ host generation 0 ufrag abc123';
function connection(lines = host) {
  return {
    signalingState: 'stable',
    remoteDescription: {
      sdp: `v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=mid:data\r\n${lines}\r\n`,
    },
    addIceCandidate: vi.fn().mockResolvedValue(undefined),
  };
}
const pc = (value: ReturnType<typeof connection>) =>
  value as unknown as RTCPeerConnection;

describe('explicit LAN route', () => {
  it('allows only unambiguous unicast IPv4 input, including an empty opt-out', () => {
    for (const address of [
      '',
      '10.0.0.2',
      '172.16.0.2',
      '172.31.255.254',
      '192.168.1.20',
      '198.51.100.20',
      '172.15.1.2',
      '172.32.1.2',
    ])
      expect(lanAddress(` ${address} `)).toBe(address);
    for (const address of [
      '127.0.0.1',
      '169.254.1.2',
      '224.0.0.1',
      '192.168.1.256',
      '192.168.01.2',
      '192.168.1',
      '0xc0.168.1.2',
      '3232235778',
      '192.168.1.2:4000',
      'https://192.168.1.2',
      '::1',
      'fe80::1',
      '10.1.1.2\n10.1.1.3',
    ])
      expect(() => lanAddress(address)).toThrow();
  });
  it('uses trickled mDNS routes that WebKit omits from remote SDP, including routes before the answer', async () => {
    vi.useFakeTimers();
    const value = connection('');
    const description = value.remoteDescription;
    Object.assign(value, { remoteDescription: undefined });
    const route = new LanRoute(pc(value), '192.168.1.20');
    const candidate = {
      candidate: host.slice(2),
      sdpMid: 'data',
      sdpMLineIndex: 0,
    };
    route.receive(candidate);
    await vi.advanceTimersByTimeAsync(250);
    expect(value.addIceCandidate).not.toHaveBeenCalled();
    value.remoteDescription = description;
    await vi.advanceTimersByTimeAsync(250);
    expect(value.addIceCandidate).toHaveBeenCalledExactlyOnceWith({
      candidate: host.slice(2).replace('hidden-device.local', '192.168.1.20'),
      sdpMid: 'data',
      sdpMLineIndex: 0,
    });
    expect(route.added).toBe(1);
    route.receive(candidate);
    await vi.advanceTimersByTimeAsync(500);
    expect(value.addIceCandidate).toHaveBeenCalledOnce();
    route.stop();
    route.receive({
      ...candidate,
      candidate: candidate.candidate.replace('50987', '50988'),
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(value.addIceCandidate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds trickle input and matches only the negotiated application section', async () => {
    vi.useFakeTimers();
    const value = connection('');
    const route = new LanRoute(pc(value), '192.168.1.20');
    for (const invalid of [
      null,
      [],
      {},
      { candidate: host.slice(2) },
      { candidate: host.slice(2), sdpMid: 'data', sdpMLineIndex: -1 },
      { candidate: host.slice(2) + '\r\na=mid:data', sdpMid: 'data' },
      { candidate: 'candidate:' + 'x'.repeat(1024), sdpMid: 'data' },
    ])
      route.receive(invalid);
    await vi.advanceTimersByTimeAsync(250);
    expect(value.addIceCandidate).not.toHaveBeenCalled();
    for (let index = 0; index < 40; index++)
      route.receive({
        candidate: host.slice(2).replace('50987', String(50000 + index)),
        sdpMLineIndex: 0,
      });
    await vi.advanceTimersByTimeAsync(250);
    expect(value.addIceCandidate).toHaveBeenCalledTimes(32);
    route.stop();
    const media = connection('');
    media.remoteDescription.sdp = media.remoteDescription.sdp.replace(
      'm=application',
      'm=audio',
    );
    const mediaRoute = new LanRoute(pc(media), '192.168.1.20');
    mediaRoute.receive({ candidate: host.slice(2), sdpMid: 'data' });
    await vi.advanceTimersByTimeAsync(250);
    expect(media.addIceCandidate).not.toHaveBeenCalled();
    mediaRoute.stop();
  });
  it('adds only the negotiated UDP host route, preserves credentials/mid/port, and deduplicates', async () => {
    vi.useFakeTimers();
    const value = connection(
      [
        host,
        host.replace('udp', 'tcp'),
        host.replace('typ host', 'typ srflx'),
        host.replace('hidden-device.local', '203.0.113.5'),
        host.replace('50987', '0'),
        host.replace('50987', '65536'),
        host.replace(' 1 udp', ' 2 udp'),
      ].join('\r\n'),
    );
    const route = new LanRoute(pc(value), '192.168.1.20');
    await vi.advanceTimersByTimeAsync(1000);
    expect(value.addIceCandidate).toHaveBeenCalledExactlyOnceWith({
      candidate: host.slice(2).replace('hidden-device.local', '192.168.1.20'),
      sdpMid: 'data',
      sdpMLineIndex: 0,
    });
    expect(route.added).toBe(1);
    value.remoteDescription.sdp += host.replace('50987', '50988') + '\r\n';
    await vi.advanceTimersByTimeAsync(250);
    expect(route.added).toBe(2);
    route.stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(value.addIceCandidate).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for trickled candidates and stops without updating after revocation', async () => {
    vi.useFakeTimers();
    const value = connection('');
    let finish!: () => void;
    value.addIceCandidate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const route = new LanRoute(pc(value), '10.1.2.3');
    await vi.advanceTimersByTimeAsync(250);
    expect(value.addIceCandidate).not.toHaveBeenCalled();
    value.remoteDescription = connection().remoteDescription;
    await vi.advanceTimersByTimeAsync(250);
    expect(value.addIceCandidate).toHaveBeenCalledTimes(1);
    route.stop();
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(route.added).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds remote routes, excludes media sections, and tolerates candidate rejection', async () => {
    vi.useFakeTimers();
    const value = connection(
      Array.from({ length: 80 }, (_, i) =>
        host.replace('50987', String(51000 + i)),
      ).join('\r\n'),
    );
    value.addIceCandidate.mockRejectedValue(new Error('unsupported route'));
    const route = new LanRoute(pc(value), '10.1.2.3');
    await vi.advanceTimersByTimeAsync(1000);
    expect(value.addIceCandidate).toHaveBeenCalledTimes(32);
    expect(route.added).toBe(0);
    route.stop();
    const media = connection();
    media.remoteDescription.sdp = media.remoteDescription.sdp.replace(
      'm=application ',
      'm=audio ',
    );
    const other = new LanRoute(pc(media), '10.1.2.3');
    await vi.advanceTimersByTimeAsync(250);
    expect(media.addIceCandidate).not.toHaveBeenCalled();
    other.stop();
    const oversized = connection('x'.repeat(65536) + '\r\n' + host);
    const large = new LanRoute(pc(oversized), '10.1.2.3');
    await vi.advanceTimersByTimeAsync(250);
    expect(oversized.addIceCandidate).not.toHaveBeenCalled();
    large.stop();
  });
  it('leaves automatic discovery unchanged without an explicit address', () => {
    vi.useFakeTimers();
    const value = connection();
    const route = new LanRoute(pc(value), '');
    expect(value.addIceCandidate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    route.stop();
  });
});
