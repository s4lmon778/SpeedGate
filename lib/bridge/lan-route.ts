/** A user-supplied local IPv4 address, used only in this tab. */
export function lanAddress(input: string) {
  const address = input.trim();
  if (!address) return '';
  const parts = address.split('.');
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)
  )
    throw new Error('Enter the other device’s local IPv4 address.');
  const [a, b] = parts.map(Number);
  // LANs can assign addresses outside RFC 1918, including shared addresses.
  // Keep those valid; reject loopback, multicast, unspecified, and link-local destinations.
  if (a === 0 || a === 127 || a >= 224 || (a === 169 && b === 254))
    throw new Error(
      'Enter the other device’s local IPv4 address, not a loopback or multicast address.',
    );
  return address;
}

function lanCandidates(
  sdp: string,
  address: string,
  trickled: RTCIceCandidateInit[],
): RTCIceCandidateInit[] {
  if (sdp.length > 65536) return [];
  const candidates: RTCIceCandidateInit[] = [];
  const sections = sdp.split(/(?:^|\r?\n)m=/).slice(1);
  for (const [index, section] of sections.entries()) {
    if (!section.startsWith('application ')) continue;
    const lines = section.split(/\r?\n/);
    const mid = lines.find((line) => line.startsWith('a=mid:'))?.slice(6);
    if (!mid || mid.length > 64) continue;
    // WebKit can accept unresolved mDNS candidates without reflecting them
    // in remoteDescription. Use delivered candidates too, only for the
    // negotiated application section and its original mid/port/credentials.
    for (const candidate of trickled) {
      if (
        candidate.sdpMid === mid ||
        (candidate.sdpMid == null && candidate.sdpMLineIndex === index)
      )
        lines.push(`a=${candidate.candidate}`);
    }
    for (const line of lines) {
      if (!line.startsWith('a=candidate:') || line.length > 1024) continue;
      const fields = line.slice(2).split(' ');
      // Keep the negotiated port, credentials, and DTLS identity. Replace only
      // a hidden host address, never a STUN/TURN address or TCP/media route.
      if (
        fields[1] !== '1' ||
        fields[2]?.toLowerCase() !== 'udp' ||
        !/^[\da-z.-]+\.local$/i.test(fields[4] ?? '') ||
        !/^\d{1,5}$/.test(fields[5] ?? '') ||
        Number(fields[5]) < 1 ||
        Number(fields[5]) > 65535 ||
        fields[6] !== 'typ' ||
        fields[7] !== 'host'
      )
        continue;
      fields[4] = address;
      candidates.push({
        candidate: fields.join(' '),
        sdpMid: mid,
        sdpMLineIndex: index,
      });
      if (candidates.length >= 32) return candidates;
    }
  }
  return candidates;
}

/** Try an explicit address before mDNS resolution/ICE times out. No signaling. */
export class LanRoute {
  added = 0;
  private seen = new Set<string>();
  private trickled = new Map<string, RTCIceCandidateInit>();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private polling = false;
  constructor(
    private pc: RTCPeerConnection,
    private address: string,
  ) {
    this.address = lanAddress(address);
    if (!this.address) return;
    this.timer = setInterval(() => void this.poll(), 250);
    void this.poll();
  }
  receive(input: unknown) {
    if (this.stopped || this.trickled.size >= 32) return;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return;
    const candidate = input as RTCIceCandidateInit;
    if (
      typeof candidate.candidate !== 'string' ||
      candidate.candidate.length > 1024 ||
      !candidate.candidate.startsWith('candidate:') ||
      /[\r\n]/.test(candidate.candidate) ||
      (candidate.sdpMid != null &&
        (typeof candidate.sdpMid !== 'string' ||
          candidate.sdpMid.length > 64)) ||
      (candidate.sdpMLineIndex != null &&
        (!Number.isInteger(candidate.sdpMLineIndex) ||
          candidate.sdpMLineIndex < 0 ||
          candidate.sdpMLineIndex > 16)) ||
      (candidate.sdpMid == null && candidate.sdpMLineIndex == null)
    )
      return;
    const value = {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid ?? null,
      sdpMLineIndex: candidate.sdpMLineIndex ?? null,
    };
    this.trickled.set(JSON.stringify(value), value);
    void this.poll();
  }
  private async poll() {
    if (this.stopped || this.polling || this.pc.signalingState === 'closed')
      return;
    this.polling = true;
    try {
      for (const candidate of lanCandidates(
        this.pc.remoteDescription?.sdp ?? '',
        this.address,
        [...this.trickled.values()],
      )) {
        if (this.stopped || this.seen.size >= 32) break;
        const key = `${candidate.sdpMid}:${candidate.candidate}`;
        if (this.seen.has(key)) continue;
        this.seen.add(key);
        try {
          await this.pc.addIceCandidate(candidate);
          if (!this.stopped) this.added++;
        } catch {
          // An unsupported route is not permission to weaken ICE or consent.
        }
      }
    } finally {
      this.polling = false;
    }
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.seen.clear();
    this.trickled.clear();
    this.address = '';
  }
}
